"use strict";

(() => {
  const slides = [...document.querySelectorAll("[data-slide]")];
  const previous = document.querySelector("#previous-slide");
  const next = document.querySelector("#next-slide");
  const status = document.querySelector("#slide-status");
  const progress = document.querySelector("#slide-progress");
  const progressFill = progress.querySelector("span");

  function indexFromHash() {
    const requested = decodeURIComponent(location.hash.slice(1));
    const index = slides.findIndex((slide) => slide.id === requested);
    return index >= 0 ? index : 0;
  }

  function render(index, updateHash) {
    const bounded = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === bounded;
      slide.hidden = !active;
      slide.setAttribute("aria-hidden", String(!active));
    });

    previous.disabled = bounded === 0;
    next.disabled = bounded === slides.length - 1;
    const position = String(bounded + 1).padStart(2, "0");
    const total = String(slides.length).padStart(2, "0");
    status.textContent = `${position} / ${total}`;
    progress.setAttribute("aria-valuenow", String(bounded + 1));
    progressFill.style.setProperty("--progress", `${((bounded + 1) / slides.length) * 100}%`);

    if (updateHash && location.hash !== `#${slides[bounded].id}`) {
      location.hash = slides[bounded].id;
    }
  }

  function move(delta) {
    render(indexFromHash() + delta, true);
  }

  previous.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));

  addEventListener("hashchange", () => render(indexFromHash(), false));
  addEventListener("keydown", (event) => {
    const tagName = event.target instanceof Element ? event.target.tagName : "";
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tagName)) return;

    if (["ArrowRight", "PageDown"].includes(event.key)) {
      event.preventDefault();
      move(1);
    } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      render(0, true);
    } else if (event.key === "End") {
      event.preventDefault();
      render(slides.length - 1, true);
    }
  });

  render(indexFromHash(), false);
})();
