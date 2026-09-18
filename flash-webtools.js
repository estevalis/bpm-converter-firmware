const ESP_WEB_TOOLS_URL =
  "https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module";


let espWebToolsLoaded =
  false;

let manifestUrl =
  null;


async function loadEspWebTools() {

  if (
    espWebToolsLoaded
  ) {
    return;
  }

  await import(
    ESP_WEB_TOOLS_URL
  );

  await customElements.whenDefined(
    "esp-web-install-button"
  );

  espWebToolsLoaded =
    true;
}


function createManifest({
  version,
  nvs,
  flashConfig,
  baseUrl
}) {

  const parts = [];


  for (
    const file of flashConfig.files
  ) {

    /*
     * factory.bin은 0x000000에 기록되므로
     * NVS 보호를 위해 제외합니다.
     */

    if (
      file.name ===
      "firmware.factory.bin"
    ) {
      continue;
    }


    parts.push({

      path:
        `${baseUrl}/firmware/${version}/${file.name}`,

      offset:
        Number(file.address)

    });
  }


  if (
    parts.length === 0
  ) {

    throw new Error(
      "플래싱할 펌웨어 파일이 없습니다."
    );
  }


  return {

    name:
      "BPM Converter",

    version:
      String(version),
    new_install_prompt_erase: true,
    builds: [

      {

        chipFamily:
          "ESP32",

        parts

      }

    ]

  };
}


function createManifestUrl(
  manifest
) {

  if (
    manifestUrl
  ) {

    URL.revokeObjectURL(
      manifestUrl
    );
  }


  const blob =
    new Blob(
      [
        JSON.stringify(
          manifest
        )
      ],
      {
        type:
          "application/json"
      }
    );


  manifestUrl =
    URL.createObjectURL(
      blob
    );


  return manifestUrl;
}


function createWebToolsElement(
  manifestUrl
) {

  const oldElement =
    document.getElementById(
      "espWebInstallButton"
    );


  if (
    oldElement
  ) {

    oldElement.remove();
  }


  const element =
    document.createElement(
      "esp-web-install-button"
    );


  element.id =
    "espWebInstallButton";


  element.setAttribute(
    "manifest",
    manifestUrl
  );


  /*
   * 화면에는 표시하지 않습니다.
   *
   * 실제 버튼은 우리가 사용하는
   * 기존 installButton입니다.
   */

  element.style.position =
    "fixed";

  element.style.left =
    "-10000px";

  element.style.top =
    "-10000px";

  element.style.width =
    "1px";

  element.style.height =
    "1px";


  document.body.appendChild(
    element
  );


  return element;
}


async function waitForWebToolsButton(
  element
) {

  /*
   * ESP Web Tools가 내부 버튼을
   * 생성할 때까지 기다립니다.
   */

  for (
    let i = 0;
    i < 100;
    i++
  ) {

    if (
      element.shadowRoot
    ) {

      const button =
        element.shadowRoot.querySelector(
          "button"
        );


      if (
        button
      ) {

        return button;
      }
    }


    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          100
        )
    );
  }


  throw new Error(
    "ESP Web Tools 설치 버튼을 찾을 수 없습니다."
  );
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

  let webToolsElement =
    null;


  try {

    setMessage(
      "ESP Web Tools를 준비하는 중..."
    );


    /*
     * ESP Web Tools 로드
     */

    await loadEspWebTools();


    setMessage(
      "펌웨어 설치 정보를 준비하는 중..."
    );


    /*
     * flash.json → Web Tools manifest
     */

    const manifest =
      createManifest({

        version,

        nvs,

        flashConfig,

        baseUrl

      });


    console.log(
      "ESP Web Tools manifest:",
      manifest
    );


    /*
     * Blob manifest 생성
     */

    const dynamicManifestUrl =
      createManifestUrl(
        manifest
      );


    console.log(
      "ESP Web Tools manifest URL:",
      dynamicManifestUrl
    );


    /*
     * Web Tools element 생성
     */

    webToolsElement =
      createWebToolsElement(
        dynamicManifestUrl
      );


    /*
     * Custom Element 내부의
     * 실제 버튼이 준비될 때까지 대기
     */

    const webToolsButton =
      await waitForWebToolsButton(
        webToolsElement
      );


    setMessage(
      "USB로 ESP32를 연결한 후 설치를 진행합니다."
    );


    /*
     * ESP Web Tools의 실제 설치 버튼 클릭
     */

    webToolsButton.click();


    /*
     * 여기서부터는 ESP Web Tools가
     * 자체 UI를 통해
     *
     * - Serial 포트 선택
     * - ESP32 연결
     * - Flash
     * - Reset
     *
     * 을 처리합니다.
     */

  } catch (
    error
  ) {

    console.error(
      "ESP Web Tools failed:",
      error
    );

    throw error;
  }

}