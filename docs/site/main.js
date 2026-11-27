(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* Film: muted autoplay only while visible and only without reduced motion */
  const film = $("#film");
  const playBtn = $("#film-play");
  const soundBtn = $("#film-sound");
  let userPaused = reduce;
  const setPlayIcon = () => {
    const paused = film.paused;
    playBtn.innerHTML = `<i class="ph-bold ${paused ? "ph-play" : "ph-pause"}" aria-hidden="true"></i>`;
    playBtn.setAttribute("aria-label", paused ? "Play film" : "Pause film");
  };
  if (film) {
    film.addEventListener("play", setPlayIcon);
    film.addEventListener("pause", setPlayIcon);
    playBtn.addEventListener("click", () => {
      if (film.paused) { userPaused = false; film.play().catch(() => {}); }
      else { userPaused = true; film.pause(); }
    });
    soundBtn.addEventListener("click", () => {
      film.muted = !film.muted;
      soundBtn.innerHTML = `<i class="ph-bold ${film.muted ? "ph-speaker-slash" : "ph-speaker-high"}" aria-hidden="true"></i>`;
      soundBtn.setAttribute("aria-label", film.muted ? "Turn sound on" : "Turn sound off");
      if (!film.muted && film.paused) { userPaused = false; film.currentTime = 0; film.play().catch(() => {}); }
    });
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !userPaused) film.play().catch(() => {});
      else if (!e.isIntersecting) film.pause();
    }, { threshold: 0.35 }).observe(film);
    setPlayIcon();
  }

  /* Nav hairline once the hero starts leaving */
  const nav = $(".nav");
  const sentinel = document.createElement("div");
  sentinel.style.cssText = "position:absolute;top:8px;height:1px;width:1px";
  document.body.prepend(sentinel);
  new IntersectionObserver(([e]) => nav.classList.toggle("is-scrolled", !e.isIntersecting)).observe(sentinel);

  /* Trail: the step in the middle of the viewport drives the pinned stage */
  const stage = $(".stage");
  const steps = $$(".step");
  const activate = (i) => {
    stage && (stage.dataset.active = String(i));
    steps.forEach((s, j) => s.classList.toggle("is-active", j === i));
  };
  if (!reduce) {
  activate(0);
  const trailObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) activate(Number(e.target.dataset.step)); });
  }, { rootMargin: "-45% 0px -45% 0px" });
  steps.forEach((s) => trailObserver.observe(s));
  }

  /* Problem: copies overwrite each other until only the SQL line is left */
  const ow = $("#overwrite");
  if (ow) {
    const items = $$("code", ow);
    const show = (k) => items.forEach((c, j) => {
      c.style.transition = reduce ? "none" : "opacity .35s cubic-bezier(.16,1,.3,1), transform .5s cubic-bezier(.16,1,.3,1), filter .35s";
      c.style.opacity = j === k ? "1" : "0";
      c.style.transform = j === k ? "none" : j < k ? "translateY(18px) scale(.96)" : "translateY(-18px)";
      c.style.filter = j === k ? "none" : "blur(6px)";
    });
    if (!reduce) {
    show(items.length - 1);
      let played = false;
      new IntersectionObserver(([e]) => {
        if (!e.isIntersecting || played) return;
        played = true;
        items.forEach((_, k) => setTimeout(() => show(k), 200 + k * 620));
      }, { threshold: 0.6 }).observe(ow);
    }
  }

  /* Reveals: content is visible by default; JS opts in */
  if (!reduce && "IntersectionObserver" in window) {
    const groups = [".problem h2", ".problem-after", ".trail h2", ".tags h2", ".tags .section-lede", ".bento .cell", ".private h2", ".facts > div", ".get-grid > div", ".close-inner"];
    const targets = [];
    groups.forEach((sel) => $$(sel).forEach((el, i) => { el.dataset.reveal = ""; el.style.transitionDelay = `${Math.min(i, 6) * 70}ms`; targets.push(el); }));
    document.documentElement.classList.add("reveal-ready");
    const ro = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); ro.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    targets.forEach((t) => ro.observe(t));
  }

  /* Mascot curls happy when privacy section arrives */
  const priv = $(".private");
  new IntersectionObserver(([e]) => priv.classList.toggle("is-in", e.isIntersecting), { threshold: 0.5 }).observe(priv);

  /* Copy install commands */
  const copyBtn = $("#copy-cmds");
  copyBtn?.addEventListener("click", async () => {
    const text = $("#cmds").innerText.replace(/^\$ /gm, "");
    const label = $("span", copyBtn);
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.classList.add("is-done"); label.textContent = "Copied";
    } catch {
      label.textContent = "Select and copy";
    }
    setTimeout(() => { copyBtn.classList.remove("is-done"); label.textContent = "Copy"; }, 2000);
  });
})();
