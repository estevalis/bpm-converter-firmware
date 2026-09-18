import {
  ESPLoader,
  Transport
} from "https://unpkg.com/esptool-js@0.6.0/bundle.js";


const BAUDRATE = 1500000;


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


    if (!response.ok) {

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

    if (!port.readable && !port.writable) {
    await port.open({
        baudRate: 115200
    });
    }

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

    await esploader.main("default_reset");


    setMessage(
      "펌웨어 파일을 다운로드하는 중..."
    );


    /*
     * GitHub Pages에서 BIN 파일 다운로드
     */

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
        const current = fileIndex + 1;
        const totalFiles = fileArray.length;

        setMessage(
          `펌웨어를 설치하는 중... ${current}/${totalFiles}, ${percent}%`
        );


        console.log(
          `Flash ${fileIndex}: ${percent}%`
        );
      }

    });


    /*
     * Flash 완료
     */

    setMessage(
      "설치가 완료되었습니다. ESP32를 재시작하는 중..."
    );


    console.log(`await transport.setRTS + hard_reset`);

    // await transport.setRTS(true);
    // await new Promise(resolve => setTimeout(resolve, 100));
    await esploader.after("hard_reset");

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