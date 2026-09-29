const ESP_WEB_TOOLS_URL =
  "./esp-web-tools/install-button.js"; // 로컬에서 사용

const LICENSE_BASE_URL =
  "./licenses";

const LICENSE_FLASH_OFFSET =
  0x28F000;

let espWebToolsLoaded = false;
let manifestUrl = null;


/*
 * ============================================================
 * ESP Web Tools
 * ============================================================
 */

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


/*
 * ============================================================
 * Manifest
 * ============================================================
 */

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

  if (parts.length === 0) {
    throw new Error(
      "플래싱할 펌웨어 파일이 없습니다."
    );
  }

  return {
    name: "BPM Converter",
    version: String(version),

    // new_install_prompt_erase: true,
    new_install_prevent_erase: true,

    builds: [
      {
        chipFamily: "ESP32",
        parts
      }
    ]
  };
}


function createManifestUrl(
  manifest
) {
  if (manifestUrl) {
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


/*
 * ============================================================
 * ESP Web Tools element
 * ============================================================
 */

function createWebToolsElement(
  manifestUrl
) {
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

  element.setAttribute(
    "baud-rate",
    "1500000"
  );

  /*
   * 화면에는 표시하지 않습니다.
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


function waitForWebToolsButton(
  element
) {
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
 * ============================================================
 * Install dialog
 * ============================================================
 */

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
        resolve(
          installDialog
        );
        return;
      }

      const cancelDialog =
        document.querySelector(
          "ewt-no-port-picked-dialog"
        );

      if (cancelDialog) {
        reject(
          new Error(
            "cancel"
          )
        );
        return;
      }

      const observer =
        new MutationObserver(
          () => {
            /*
             * 정상적으로 포트를 선택한 경우
             */
            const installDialog =
              document.querySelector(
                "ewt-install-dialog"
              );

            if (installDialog) {
              observer.disconnect();

              resolve(
                installDialog
              );

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
                new Error(
                  "cancel"
                )
              );
            }
          }
        );

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
 * ============================================================
 * License
 * ============================================================
 */

function normalizeMac(
  mac
) {
  return String(mac)
    .replace(
      /[^0-9A-Fa-f]/g,
      ""
    )
    .toUpperCase();
}


async function getLicenseJson(
  mac
) {
  const macHex =
    normalizeMac(mac);

  if (
    !/^[0-9A-F]{12}$/.test(
      macHex
    )
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

  const response =
    await fetch(
      url,
      {
        cache: "no-store"
      }
    );

  /*
   * 해당 MAC에 대한 라이선스가 없는 경우
   *
   * license partition에는 아무것도 추가하지 않습니다.
   */
  if (
    response.status === 404
  ) {
    console.log(
      "License not found:",
      fileName
    );

    return null;
  }

  if (!response.ok) {
    throw new Error(
      `라이선스 조회 실패: HTTP ${response.status}`
    );
  }

  const license =
    await response.json();

  if (
    !license ||
    typeof license.mac !==
      "string"
  ) {
    throw new Error(
      "잘못된 라이선스 JSON입니다."
    );
  }

  if (
    typeof license.signature !==
      "string"
  ) {
    throw new Error(
      "라이선스 signature가 없습니다."
    );
  }

  /*
   * GitHub 파일 이름으로 찾은 MAC과
   * JSON 내부 MAC도 반드시 일치해야 합니다.
   */
  if (
    normalizeMac(
      license.mac
    ) !== macHex
  ) {
    throw new Error(
      "라이선스 MAC이 ESP32 MAC과 일치하지 않습니다."
    );
  }

  console.log(
    "License JSON:",
    license
  );

  return license;
}


function createLicenseBin(
  license
) {
  if (
    !license ||
    typeof license.mac !==
      "string"
  ) {
    throw new Error(
      "잘못된 라이선스 JSON입니다."
    );
  }

  if (
    typeof license.signature !==
      "string"
  ) {
    throw new Error(
      "라이선스 signature가 없습니다."
    );
  }

  const macHex =
    normalizeMac(
      license.mac
    );

  if (
    !/^[0-9A-F]{12}$/.test(
      macHex
    )
  ) {
    throw new Error(
      `잘못된 라이선스 MAC입니다: ${license.mac}`
    );
  }

  let signature;

  try {
    signature =
      Uint8Array.from(
        atob(
          license.signature
        ),
        c =>
          c.charCodeAt(0)
      );
  } catch {
    throw new Error(
      "라이선스 signature가 올바른 Base64 형식이 아닙니다."
    );
  }

  if (
    signature.length !== 64
  ) {
    throw new Error(
      `잘못된 Ed25519 signature 길이입니다: ${signature.length}`
    );
  }

  /*
   * License binary format
   *
   * 0x00  4 bytes   "LCNS"
   * 0x04  1 byte    version
   * 0x05  1 byte    reserved
   * 0x06  6 bytes   MAC
   * 0x0C 64 bytes   Ed25519 signature
   *
   * Total: 76 bytes
   */
  const data =
    new Uint8Array(
      76
    );

  /*
   * Magic: "LCNS"
   */
  data[0] =
    0x4c;

  data[1] =
    0x43;

  data[2] =
    0x4e;

  data[3] =
    0x53;

  /*
   * Version
   */
  data[4] =
    1;

  /*
   * Reserved
   */
  data[5] =
    0;

  /*
   * MAC
   */
  for (
    let i = 0;
    i < 6;
    i++
  ) {
    data[6 + i] =
      parseInt(
        macHex.substring(
          i * 2,
          i * 2 + 2
        ),
        16
      );
  }

  /*
   * Ed25519 signature
   */
  data.set(
    signature,
    12
  );

  return data;
}


function createLicenseUrl(
  licenseBin
) {
  const blob =
    new Blob(
      [licenseBin],
      {
        type:
          "application/octet-stream"
      }
    );

  return URL.createObjectURL(
    blob
  );
}


/*
 * ============================================================
 * One-port MAC/license hook
 * ============================================================
 *
 * ESP Web Tools의 install-button.js는
 *
 *   navigator.serial.requestPort()
 *       ↓
 *   ewt-install-dialog
 *       ↓
 *   window.esploader = d
 *       ↓
 *   await d.main()
 *
 * 순서로 동작합니다.
 *
 * 따라서 별도의 navigator.serial.requestPort()를
 * 호출하지 않습니다.
 *
 * window.esploader에 값이 대입되는 순간
 * d.main()을 wrapper로 교체합니다.
 *
 * 그러면:
 *
 *   d.main()
 *       ↓
 *   원래 ESP Web Tools의 main()
 *       ↓
 *   MAC 확인 완료
 *       ↓
 *   license 조회
 *       ↓
 *   installDialog._manifest 수정
 *       ↓
 *   원래 _confirmInstall() 계속 진행
 *
 * 이 됩니다.
 */

function installEsploaderHook(
  installDialog,
  setMessage
) {
  let currentLoader =
    undefined;

  let originalDescriptor =
    Object.getOwnPropertyDescriptor(
      window,
      "esploader"
    );

  let licenseUrl =
    null;

  let hookActive =
    true;

  /*
   * 기존 esploader가 있다면 저장합니다.
   */
  if (
    originalDescriptor &&
    !originalDescriptor.configurable
  ) {
    throw new Error(
      "window.esploader를 사용할 수 없습니다."
    );
  }

  if (
    originalDescriptor
  ) {
    try {
      currentLoader =
        window.esploader;
    } catch {
      currentLoader =
        undefined;
    }
  }

  /*
   * 이전 값이 있으면 제거합니다.
   */
  try {
    delete window.esploader;
  } catch {
  }

  const prepareLicense =
    async loader => {
      if (!hookActive) {
        return;
      }

      if (
        !loader ||
        !loader.chip ||
        typeof loader.chip.readMac !==
          "function"
      ) {
        throw new Error(
          "ESP32 MAC 주소를 읽을 수 없습니다."
        );
      }

      /*
       * d.main()이 끝난 뒤이므로
       * chip 객체가 이미 결정되어 있습니다.
       *
       * 별도의 포트 선택은 하지 않습니다.
       */
      const mac =
        await loader.chip.readMac(
          loader
        );

      console.log(
        "ESP32 MAC:",
        mac
      );

      if (setMessage) {
        setMessage(
          "ESP32 라이선스를 확인하는 중..."
        );
      }

      const license =
        await getLicenseJson(
          mac
        );

      /*
       * 해당 MAC의 라이선스가 없으면
       * manifest를 그대로 둡니다.
       */
      if (!license) {
        console.log(
          "No license for:",
          mac
        );

        return;
      }

      const licenseBin =
        createLicenseBin(
          license
        );

      licenseUrl =
        createLicenseUrl(
          licenseBin
        );

      console.log(
        "License binary:",
        licenseBin.length,
        "bytes"
      );

      /*
       * ESP Web Tools가 실제로 사용할
       * manifest입니다.
       *
       * createManifest()에서 만든 원본 객체가 아니라,
       * ewt-install-dialog가 manifest URL을 fetch해서
       * 생성한 _manifest를 수정해야 합니다.
       */
      const manifest =
        installDialog._manifest;

      if (
        !manifest ||
        !Array.isArray(
          manifest.builds
        )
      ) {
        throw new Error(
          "ESP Web Tools manifest를 찾을 수 없습니다."
        );
      }

      const build =
        manifest.builds.find(
          build =>
            build.chipFamily ===
            loader.chip.CHIP_NAME
        );

      if (!build) {
        throw new Error(
          `지원되지 않는 ESP 칩입니다: ${loader.chip.CHIP_NAME}`
        );
      }

      if (
        !Array.isArray(
          build.parts
        )
      ) {
        throw new Error(
          "ESP Web Tools manifest의 parts를 찾을 수 없습니다."
        );
      }

      /*
       * 중복 추가 방지
       */
      const alreadyAdded =
        build.parts.some(
          part =>
            Number(part.offset) ===
            LICENSE_FLASH_OFFSET
        );

      if (!alreadyAdded) {
        build.parts.push({
          path:
            licenseUrl,
          offset:
            LICENSE_FLASH_OFFSET
        });
      }

      console.log(
        "ESP Web Tools manifest with license:",
        manifest
      );
    };

  const wrappedMain =
    loader => {
      if (
        !loader ||
        typeof loader.main !==
          "function"
      ) {
        throw new Error(
          "ESP Web Tools ESPLoader를 찾을 수 없습니다."
        );
      }

      const originalMain =
        loader.main.bind(
          loader
        );

      /*
       * 같은 loader에 두 번 hook하지 않습니다.
       */
      if (
        loader.__bpmLicenseMainHooked
      ) {
        return;
      }

      loader.__bpmLicenseMainHooked =
        true;

      loader.main =
        async (...args) => {
          /*
           * 먼저 ESP Web Tools의 원래 main()을
           * 그대로 실행합니다.
           *
           * 이 과정에서:
           * - chip detect
           * - MAC read
           * - stub 실행
           * 등이 수행됩니다.
           */
          const result =
            await originalMain(
              ...args
            );

          /*
           * main() 완료 후 MAC을 다시 읽고
           * 실제 installDialog._manifest에
           * license part를 추가합니다.
           *
           * 이 함수가 완료될 때까지
           * _confirmInstall()의 다음 줄인
           *
           *   await d.flashId()
           *
           * 로 넘어가지 않습니다.
           */
          await prepareLicense(
            loader
          );

          return result;
        };
    };

  /*
   * ESP Web Tools의
   *
   *   window.esploader = d
   *
   * 대입을 잡습니다.
   */
  Object.defineProperty(
    window,
    "esploader",
    {
      configurable: true,
      enumerable: true,

      get() {
        return currentLoader;
      },

      set(loader) {
        currentLoader =
          loader;

        console.log(
          "ESP Web Tools ESPLoader detected:",
          loader
        );

        try {
          wrappedMain(
            loader
          );
        } catch (error) {
          console.error(
            "Failed to hook ESPLoader:",
            error
          );

          /*
           * main() 자체가 호출될 때
           * 해당 오류가 발생하도록 저장합니다.
           */
          loader.__bpmLicenseHookError =
            error;
        }
      }
    }
  );

  return {
    getLicenseUrl() {
      return licenseUrl;
    },

    cleanup() {
      hookActive =
        false;

      /*
       * window.esploader에 현재 loader가
       * 들어있는 상태에서 원래 descriptor를
       * 복원합니다.
       */
      try {
        delete window.esploader;
      } catch {
      }

      if (
        originalDescriptor
      ) {
        try {
          Object.defineProperty(
            window,
            "esploader",
            originalDescriptor
          );
        } catch {
        }
      }

      /*
       * 원래 esploader가 없었던 경우
       * window.esploader를 없는 상태로 둡니다.
       */
      else {
        try {
          delete window.esploader;
        } catch {
        }
      }
    }
  };
}


/*
 * ============================================================
 * Flash state
 * ============================================================
 */

/*
 * ESP Web Tools의 실제 Flash 상태를 기다립니다.
 *
 * FlashStateType.FINISHED의 실제 값:
 *   "finished"
 *
 * 포트 선택이나 연결 단계에서는
 * 시간 제한을 두지 않습니다.
 */
function waitForFlashFinished(
  dialog
) {
  return new Promise(
    (resolve, reject) => {
      let lastState =
        null;

      const check =
        () => {
          /*
           * ESP Web Tools 내부 상태입니다.
           */
          const installState =
            dialog._installState;

          if (
            installState
          ) {
            const state =
              installState.state;

            if (
              state !==
              lastState
            ) {
              console.log(
                "ESP Web Tools flash state:",
                state
              );

              lastState =
                state;
            }

            /*
             * 실제 Flash 완료
             */
            if (
              state ===
              "finished"
            ) {
              console.log(
                "ESP Web Tools: FlashStateType.FINISHED"
              );

              resolve();

              return;
            }

            /*
             * 실제 Flash 실패
             */
            if (
              state ===
              "error"
            ) {
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


/*
 * ============================================================
 * Flash
 * ============================================================
 */

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

  let installDialog =
    null;

  let esploaderHook =
    null;

  try {
    setMessage(
      "ESP Web Tools를 준비하는 중..."
    );

    await loadEspWebTools();

    setMessage(
      "펌웨어 설치 정보를 준비하는 중..."
    );

    /*
     * 처음에는 라이선스 없이
     * 일반 firmware manifest를 만듭니다.
     *
     * 실제 선택 포트의 MAC은 아직 알 수 없기
     * 때문에 이 시점에서는 license part를
     * 넣지 않습니다.
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
     *
     * 여기서 ESP Web Tools가
     * navigator.serial.requestPort()를
     * 한 번 호출합니다.
     */
    webToolsButton.click();

    /*
     * 포트 선택 결과를 기다립니다.
     *
     * 이 시점에서 사용자가 선택한 실제
     * SerialPort가 installDialog.port에
     * 들어 있습니다.
     */
    installDialog =
      await waitForInstallDialogOrCancel();

    console.log(
      "ESP Web Tools install dialog:",
      installDialog
    );

    /*
     * ========================================================
     * 중요
     * ========================================================
     *
     * 이제부터는 navigator.serial.requestPort()
     * 를 절대로 호출하지 않습니다.
     *
     * ESP Web Tools가 같은 포트를 사용해서
     * window.esploader를 만드는 순간을 잡습니다.
     */
    esploaderHook =
      installEsploaderHook(
        installDialog,
        setMessage
      );

    setMessage(
      "ESP32에 펌웨어를 설치할 준비가 되었습니다."
    );

    /*
     * 실제 Flash가 FINISHED가 될 때까지
     * 기다립니다.
     *
     * 사용자가 INSTALL을 누르면
     * ESP Web Tools 내부에서:
     *
     *   window.esploader = d
     *
     * 가 실행되고,
     *
     * 우리의 hook이 d.main()을 감쌉니다.
     *
     * d.main() 완료 후:
     *
     *   MAC 확인
     *   ↓
     *   license 조회
     *   ↓
     *   license.bin Blob URL 생성
     *   ↓
     *   installDialog._manifest 수정
     *
     * 이 끝난 뒤에야 ESP Web Tools의
     * 원래 flash 과정이 계속됩니다.
     */
    setMessage(
      "ESP32에서 라이선스를 확인하는 중..."
    );

    await waitForFlashFinished(
      installDialog
    );

    /*
     * 실제 FlashStateType.FINISHED까지
     * 도달한 경우에만 정상 종료입니다.
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
     * ESPLoader hook 제거
     */
    if (
      esploaderHook
    ) {
      const licenseUrl =
        esploaderHook.getLicenseUrl();

      esploaderHook.cleanup();

      /*
       * Flash가 끝난 뒤에는 더 이상
       * license Blob URL이 필요하지 않습니다.
       */
      if (
        licenseUrl
      ) {
        URL.revokeObjectURL(
          licenseUrl
        );
      }
    }

    /*
     * 우리가 만든 숨겨진
     * esp-web-install-button만 제거합니다.
     *
     * ESP Web Tools의 실제 dialog는
     * ESP Web Tools가 자체적으로 관리합니다.
     */
    if (
      webToolsElement
    ) {
      webToolsElement.remove();
    }
  }
}