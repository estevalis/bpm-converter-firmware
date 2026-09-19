const ESP_WEB_TOOLS_URL =
  "https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module";

let espWebToolsLoaded = false;
let manifestUrl = null;


async function loadEspWebTools() {
  if (espWebToolsLoaded) {
    return;
  }

  await import(ESP_WEB_TOOLS_URL);
  await customElements.whenDefined(
    "esp-web-install-button"
  );

  espWebToolsLoaded = true;
}


function createManifest({
  version,
  nvs,
  flashConfig,
  baseUrl
}) {
  const parts = [];

  for (const file of flashConfig.files) {
    /*
     * factory.bin은 0x000000에 기록되므로
     * NVS 보호를 위해 제외합니다.
     */
    if (file.name === "firmware.factory.bin") {
      continue;
    }

    parts.push({
      path:
        `${baseUrl}/firmware/${version}/${file.name}`,
      offset: Number(file.address)
    });
  }

  if (parts.length === 0) {
    throw new Error(
      "플래싱할 펌웨어 파일이 없습니다."
    );
  }

  return {
    name: "BPM Converter",
    version: String(version),
    new_install_prompt_erase: true,
    builds: [
      {
        chipFamily: "ESP32",
        parts
      }
    ]
  };
}


function createManifestUrl(manifest) {
  if (manifestUrl) {
    URL.revokeObjectURL(manifestUrl);
  }

  const blob = new Blob(
    [JSON.stringify(manifest)],
    {
      type: "application/json"
    }
  );

  manifestUrl =
    URL.createObjectURL(blob);

  return manifestUrl;
}


function createWebToolsElement(manifestUrl) {
  const oldElement =
    document.getElementById(
      "espWebInstallButton"
    );

  if (oldElement) {
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
   */
  element.style.position = "fixed";
  element.style.left = "-10000px";
  element.style.top = "-10000px";
  element.style.width = "1px";
  element.style.height = "1px";

  document.body.appendChild(
    element
  );

  return element;
}


function waitForWebToolsButton(element) {
  return new Promise(
    (resolve, reject) => {
      const check = () => {
        if (element.shadowRoot) {
          const button =
            element.shadowRoot.querySelector(
              "button"
            );

          if (button) {
            resolve(button);
            return;
          }
        }

        setTimeout(
          check,
          100
        );
      };

      check();
    }
  );
}


/*
 * ESP Web Tools의 포트 선택 결과를 기다립니다.
 *
 * 정상:
 *   ewt-install-dialog 생성
 *
 * 취소:
 *   ewt-no-port-picked-dialog 생성
 *
 * 포트 선택에는 시간 제한을 두지 않습니다.
 */
function waitForInstallDialogOrCancel() {
  return new Promise(
    (resolve, reject) => {
      /*
       * 이미 생성되어 있는지 먼저 확인합니다.
       */
      const installDialog =
        document.querySelector(
          "ewt-install-dialog"
        );

      if (installDialog) {
        resolve(installDialog);
        return;
      }

      const cancelDialog =
        document.querySelector(
          "ewt-no-port-picked-dialog"
        );

      if (cancelDialog) {
        reject(
          new Error("cancel")
        );
        return;
      }

      const observer =
        new MutationObserver(() => {
          /*
           * 정상적으로 포트를 선택한 경우
           */
          const installDialog =
            document.querySelector(
              "ewt-install-dialog"
            );

          if (installDialog) {
            observer.disconnect();
            resolve(installDialog);
            return;
          }

          /*
           * 포트 선택을 취소한 경우
           */
          const cancelDialog =
            document.querySelector(
              "ewt-no-port-picked-dialog"
            );

          if (cancelDialog) {
            observer.disconnect();

            reject(
              new Error("cancel")
            );
          }
        });

      observer.observe(
        document.body,
        {
          childList: true,
          subtree: true
        }
      );
    }
  );
}


/*
 * ESP Web Tools의 실제 Flash 상태를 기다립니다.
 *
 * FlashStateType.FINISHED의 실제 값:
 *   "finished"
 *
 * 포트 선택이나 연결 단계에서는
 * 시간 제한이 없습니다.
 */
function waitForFlashFinished(dialog) {
  return new Promise(
    (resolve, reject) => {
      let lastState = null;

      const check = () => {
        /*
         * ESP Web Tools 내부 상태입니다.
         */
        const installState =
          dialog._installState;

        if (installState) {
          const state =
            installState.state;

          if (state !== lastState) {
            console.log(
              "ESP Web Tools flash state:",
              state
            );

            lastState = state;
          }

          /*
           * 실제 Flash 완료
           */
          if (state === "finished") {
            console.log(
              "ESP Web Tools: FlashStateType.FINISHED"
            );

            resolve();
            return;
          }

          /*
           * 실제 Flash 실패
           */
          if (state === "error") {
            console.error(
              "ESP Web Tools error:",
              installState
            );

            reject(
              new Error(
                installState.message ||
                "ESP Web Tools 펌웨어 설치에 실패했습니다."
              )
            );

            return;
          }
        }

        setTimeout(
          check,
          100
        );
      };

      check();
    }
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
  let webToolsElement = null;

  try {
    setMessage(
      "ESP Web Tools를 준비하는 중..."
    );

    await loadEspWebTools();

    setMessage(
      "펌웨어 설치 정보를 준비하는 중..."
    );

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

    const dynamicManifestUrl =
      createManifestUrl(
        manifest
      );

    console.log(
      "ESP Web Tools manifest URL:",
      dynamicManifestUrl
    );

    webToolsElement =
      createWebToolsElement(
        dynamicManifestUrl
      );

    const webToolsButton =
      await waitForWebToolsButton(
        webToolsElement
      );

    setMessage(
      "USB로 ESP32를 연결한 후 설치를 진행합니다."
    );

    /*
     * ESP Web Tools의 실제 설치 버튼을 클릭합니다.
     */
    webToolsButton.click();

    /*
     * 여기서는 포트 선택 시간을 제한하지 않습니다.
     *
     * 결과는 두 가지입니다.
     *
     * 1. 포트 선택
     *    → ewt-install-dialog
     *
     * 2. 포트 선택 취소
     *    → ewt-no-port-picked-dialog
     */
    const installDialog =
      await waitForInstallDialogOrCancel();

    console.log(
      "ESP Web Tools install dialog:",
      installDialog
    );

    setMessage(
      "ESP32에 펌웨어를 설치하는 중입니다..."
    );

    /*
     * 실제 Flash가 FINISHED가 될 때까지 기다립니다.
     */
    await waitForFlashFinished(
      installDialog
    );

    /*
     * 실제 FlashStateType.FINISHED까지
     * 도달한 경우에만 flash()가 정상 종료됩니다.
     */
    console.log(
      "ESP Web Tools firmware installation finished."
    );
  } catch (error) {
    console.error(
      "ESP Web Tools failed:",
      error
    );

    throw error;
  } finally {
    /*
     * 우리가 만든 숨겨진
     * esp-web-install-button만 제거합니다.
     *
     * ESP Web Tools의 실제 dialog는
     * ESP Web Tools가 자체적으로 관리합니다.
     */
    if (webToolsElement) {
      webToolsElement.remove();
    }
  }
}