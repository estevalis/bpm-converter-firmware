import {
  ESPLoader,
  Transport
} from "https://unpkg.com/esptool-js@0.6.0/bundle.js";

const BAUDRATE = 1500000;
const LICENSE_BASE_URL = "./licenses";


function createTerminal() {

  return {

    clean() {
    },

    writeLine(data) {
      console.log(data);
    },

    write(data) {
      console.log(data);
    }

  };
}


function normalizeMac(mac) {

  return String(mac)
    .replace(/[^0-9A-Fa-f]/g, "")
    .toUpperCase();

}


async function fetchLicense(mac) {

  const macHex =
    normalizeMac(mac);

  if (
    macHex.length !== 12
  ) {

    throw new Error(
      `ESP32 MAC 주소가 올바르지 않습니다: ${mac}`
    );

  }


  const fileName =
    `${macHex}.json`;

  const url =
    `${LICENSE_BASE_URL}/${fileName}`;


  console.log(
    "License URL:",
    url
  );


  let response;

  try {

    response =
      await fetch(
        url,
        {
          cache: "no-store"
        }
      );

  } catch (error) {

    throw new Error(
      `라이선스 파일을 확인할 수 없습니다.\n${error.message}`
    );

  }


  if (
    response.status === 404
  ) {

    return null;

  }


  if (
    !response.ok
  ) {

    throw new Error(
      `라이선스 파일을 가져오지 못했습니다. HTTP ${response.status}`
    );

  }


  let license;

  try {

    license =
      await response.json();

  } catch {

    throw new Error(
      "라이선스 파일의 JSON 형식이 올바르지 않습니다."
    );

  }


  if (
    !license ||
    typeof license !== "object"
  ) {

    throw new Error(
      "라이선스 파일의 형식이 올바르지 않습니다."
    );

  }


  if (
    typeof license.mac !== "string"
  ) {

    throw new Error(
      "라이선스 파일에 MAC 주소가 없습니다."
    );

  }


  if (
    typeof license.signature !== "string"
  ) {

    throw new Error(
      "라이선스 파일에 signature가 없습니다."
    );

  }


  if (
    normalizeMac(license.mac) !== macHex
  ) {

    throw new Error(
      "라이선스의 MAC 주소가 장치와 일치하지 않습니다."
    );

  }


  return license;

}


function createLicenseBin(license) {

  const macHex =
    normalizeMac(license.mac);


  if (
    macHex.length !== 12
  ) {

    throw new Error(
      "라이선스 MAC 주소가 올바르지 않습니다."
    );

  }


  let signatureBytes;

  try {

    const binary =
      atob(license.signature);


    signatureBytes =
      new Uint8Array(
        binary.length
      );


    for (
      let i = 0;
      i < binary.length;
      i++
    ) {

      signatureBytes[i] =
        binary.charCodeAt(i);

    }

  } catch {

    throw new Error(
      "라이선스 signature의 Base64 형식이 올바르지 않습니다."
    );

  }


  if (
    signatureBytes.length !== 64
  ) {

    throw new Error(
      `라이선스 signature 길이가 올바르지 않습니다. (${signatureBytes.length} bytes)`
    );

  }


  /*
   * License binary format
   *
   * 0 - 3   : "LCNS"
   * 4       : version = 1
   * 5       : reserved = 0
   * 6 - 11  : MAC address
   * 12 - 75 : Ed25519 signature
   *
   * Total: 76 bytes
   */

  const result =
    new Uint8Array(76);


  // Magic: LCNS
  result[0] = 0x4C;
  result[1] = 0x43;
  result[2] = 0x4E;
  result[3] = 0x53;


  // Version
  result[4] = 1;


  // Reserved
  result[5] = 0;


  // MAC address
  for (
    let i = 0;
    i < 6;
    i++
  ) {

    result[6 + i] =
      parseInt(
        macHex.substr(
          i * 2,
          2
        ),
        16
      );

  }


  // Ed25519 signature
  result.set(
    signatureBytes,
    12
  );


  console.log(
    "License binary:",
    result
  );


  return result;

}


async function fetchFlashFiles(
  version,
  flashConfig,
  baseUrl
) {

  const files = [];


  for (
    const file of flashConfig.files
  ) {

    /*
     * firmware.factory.bin은
     * 0x000000에 기록되므로 제외합니다.
     *
     * 이 파일을 사용하면 NVS를 포함한
     * Flash 영역을 초기화할 수 있습니다.
     */

    if (
      file.name ===
      "firmware.factory.bin"
    ) {

      continue;
    }


    const url =
      `${baseUrl}/firmware/${version}/${file.name}`;


    console.log(
      "Downloading:",
      url
    );


    const response =
      await fetch(
        url,
        {
          cache: "no-store"
        }
      );


    if (
      !response.ok
    ) {

      throw new Error(
        `${file.name} HTTP ${response.status}`
      );

    }


    const buffer =
      await response.arrayBuffer();


    files.push({

      name:
        file.name,

      address:
        Number(file.address),

      data:
        new Uint8Array(
          buffer
        )

    });

  }


  return files;

}


function getLicenseAddress(
  flashConfig
) {

  if (
    !flashConfig ||
    !flashConfig.license
  ) {

    throw new Error(
      "flash.json에 license 설정이 없습니다."
    );

  }


  if (
    typeof flashConfig.license.address !==
    "string"
  ) {

    throw new Error(
      "flash.json의 license.address가 올바르지 않습니다."
    );

  }


  const address =
    Number(
      flashConfig.license.address
    );


  if (
    !Number.isInteger(address) ||
    address < 0
  ) {

    throw new Error(
      "flash.json의 license.address가 올바르지 않습니다."
    );

  }


  return address;

}


export async function flash({
  version,
  nvs,
  flashConfig,
  baseUrl,
  setMessage,
  setHtmlMessage,
  setFirmwareInfo
}) {

  let port =
    null;

  let transport =
    null;

  let esploader =
    null;


  try {

    setMessage(
      "USB 포트를 선택해주세요."
    );


    /*
     * 브라우저의 USB Serial 포트 선택창
     */

    port =
      await navigator.serial.requestPort();


    setMessage(
      "ESP32에 연결하는 중..."
    );


    transport =
      new Transport(
        port,
        true
      );


    esploader =
      new ESPLoader({

        transport,

        baudrate:
          BAUDRATE,

        terminal:
          createTerminal(),

        debugLogging:
          false

      });


    /*
     * ESP32 연결 및 칩 정보 확인
     */

    await esploader.main(
      "default_reset"
    );


    /*
     * ESP32 MAC 주소 확인
     */

    setMessage(
      "ESP32 라이선스를 확인하는 중..."
    );


    const mac =
      await esploader.chip.readMac(
        esploader
      );


    console.log(
      "ESP32 MAC:",
      mac
    );


    /*
     * MAC에 해당하는 라이선스 파일 확인
     */

    const license =
      await fetchLicense(
        mac
      );


    if (!license) {

      throw new Error(
        `등록되지 않은 장치입니다.\nMAC: ${mac}`
      );

    }


    /*
     * 라이선스 바이너리 생성
     */

    const licenseData =
      createLicenseBin(
        license
      );


    /*
     * flash.json에서 라이선스 주소 확인
     */

    const licenseAddress =
      getLicenseAddress(
        flashConfig
      );


    console.log(
      "License address:",
      `0x${licenseAddress.toString(16)}`
    );


    /*
     * GitHub Pages에서 BIN 파일 다운로드
     */

    setMessage(
      "펌웨어 파일을 다운로드하는 중..."
    );


    const files =
      await fetchFlashFiles(
        version,
        flashConfig,
        baseUrl
      );


    if (
      files.length === 0
    ) {

      throw new Error(
        "플래싱할 펌웨어 파일이 없습니다."
      );

    }


    /*
     * 라이선스를 마지막에 추가합니다.
     */

    files.push({

      name:
        "license",

      address:
        licenseAddress,

      data:
        licenseData

    });


    console.log(
      "Flash files:",
      files
    );


    /*
     * esptool-js 형식으로 변환
     */

    const fileArray =
      files.map(
        file => ({

          data:
            file.data,

          address:
            file.address

        })
      );


    const eraseAll =
      nvs === "erase";


    console.log(
      "NVS:",
      nvs
    );


    console.log(
      "eraseAll:",
      eraseAll
    );


    /*
     * Flash
     */

    setMessage(
      "펌웨어를 설치하는 중..."
    );


    await esploader.writeFlash({

      fileArray,

      flashMode:
        "keep",

      flashFreq:
        "keep",

      flashSize:
        "keep",

      /*
       * 기본값:
       * false → NVS 유지
       *
       * NVS 초기화를 선택했을 때만
       * true가 됩니다.
       */

      eraseAll,

      compress:
        true,

      reportProgress(
        fileIndex,
        written,
        total
      ) {

        if (
          total <= 0
        ) {

          return;

        }


        const percent =
          Math.floor(
            written *
            100 /
            total
          );


        const current =
          fileIndex + 1;


        const totalFiles =
          fileArray.length;


        const file =
          files[fileIndex];


        const fileName =
          file
            ? file.name
            : "";


        setMessage(
          `펌웨어를 설치하는 중... ${current}/${totalFiles}, ${percent}%`
        );


        console.log(
          `Flash ${fileIndex}: ${fileName} ${percent}%`
        );

      }

    });


    /*
     * Flash 완료
     */

    setMessage(
      "설치가 완료되었습니다. ESP32를 재시작하는 중..."
    );

    console.log("Executing hard reset sequence...");

    await port.setSignals({
      dataTerminalReady: false,
      requestToSend: true
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    await port.setSignals({
      dataTerminalReady: true,
      requestToSend: false
    });
    await new Promise(resolve => setTimeout(resolve, 50));

    await port.setSignals({
      dataTerminalReady: false,
      requestToSend: false
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    setMessage(
      "펌웨어 설치가 완료되었습니다."
    );


  } finally {

    /*
     * Serial 연결 정리
     */

    try {

      if (
        transport
      ) {

        await transport.disconnect();

      }

    } catch (
      disconnectError
    ) {

      console.warn(
        "Serial disconnect failed:",
        disconnectError
      );

    }

  }

}