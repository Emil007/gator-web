(() => {
  const EJS_CDN = "https://cdn.emulatorjs.org/stable/data/";

  const VARIANTS = [
    {
      id: "us",
      label: "US / EU",
      path: "roms/Pinball - Revenge of the 'Gator (USA, Europe).gb",
    },
    {
      id: "jp",
      label: "Japan",
      path: "roms/Pinball - 66hiki no Wani Daikoushin! (Japan).gb",
    },
    {
      id: "beta",
      label: "Beta",
      path: "roms/Pinball - Revenge of the 'Gator (USA, Europe) (Beta).gb",
    },
  ];

  const drop = document.getElementById("drop");
  const play = document.getElementById("play");
  const fileInput = document.getElementById("file");
  const romName = document.getElementById("rom-name");
  const eject = document.getElementById("eject");
  const quick = document.getElementById("quick");
  const quickButtons = document.getElementById("quick-buttons");

  let objectUrl = null;
  let started = false;

  function showDrop() {
    drop.hidden = false;
    play.hidden = true;
  }

  function showPlay(name) {
    drop.hidden = true;
    play.hidden = false;
    romName.textContent = name;
  }

  function romUrlBase() {
    // Served from repo root: /player/ → /roms/
    // Served from player/: try ../roms/
    const path = location.pathname.replace(/\\/g, "/");
    if (path.includes("/player")) {
      return "../";
    }
    return "./";
  }

  async function probeLocalRoms() {
    const base = romUrlBase();
    const available = [];
    await Promise.all(
      VARIANTS.map(async (v) => {
        try {
          const res = await fetch(base + v.path, { method: "HEAD", cache: "no-store" });
          if (res.ok) available.push({ ...v, url: base + v.path });
        } catch {
          /* offline / file:// */
        }
      })
    );
    return available;
  }

  function startEmulator(url, name) {
    if (started) {
      location.reload();
      return;
    }
    started = true;
    showPlay(name);

    window.EJS_player = "#game";
    window.EJS_core = "gb";
    window.EJS_gameUrl = url;
    window.EJS_pathtodata = EJS_CDN;
    window.EJS_color = "#0f380f";
    window.EJS_startOnLoaded = true;
    window.EJS_gameName = name.replace(/\.(gb|gbc|zip)$/i, "");

    const script = document.createElement("script");
    script.src = EJS_CDN + "loader.js";
    document.body.appendChild(script);
  }

  function loadFile(file) {
    if (!file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    startEmulator(objectUrl, file.name);
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    loadFile(file);
  });

  ;["dragenter", "dragover"].forEach((evt) => {
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.classList.add("dragover");
    });
  });

  ;["dragleave", "drop"].forEach((evt) => {
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.classList.remove("dragover");
    });
  });

  drop.addEventListener("drop", (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    loadFile(file);
  });

  eject.addEventListener("click", () => {
    location.reload();
  });

  async function init() {
    showDrop();
    const available = await probeLocalRoms();
    if (!available.length) return;
    quick.hidden = false;
    for (const v of available) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = v.label;
      btn.addEventListener("click", () => {
        startEmulator(v.url, v.path.split("/").pop());
      });
      quickButtons.appendChild(btn);
    }
  }

  init();
})();
