/* Каталог «Модельный ряд» + блок «Комплектации».
   Данные: data/catalog.json → табы семейств (якоря) → блоки семейств столбиком
   → в блоке: карточка + лента модификаций → trims.
   Логика: скролл к семейству, кузов миниатюрой, без слайдера карточек. */
(function () {
  var money = new Intl.NumberFormat("ru-RU");
  var allModels = [];
  var activeFamily = ""; // id семейства, подсвеченного в табах
  var modIndexByFamily = {}; // familyId → индекс активной модификации
  var scrollSpyPause = false; // не трогать табы во время программного скролла
  var scrollSpyTimer = 0;
  var familyObserver = null;
  var slideSwapTimers = {}; // familyId → timeout смены слайда
  var SLIDE_FADE_MS = 380;

  // ——— HELPERS ———

  function formatPrice(value) {
    return money.format(value) + " ₽";
  }

  // Разбивает платёж на части для отдельной стилизации «от / сумма / ₽/мес.»
  function paymentParts(raw) {
    var digits = String(raw || "").replace(/\D/g, "");
    if (!digits) return null;
    return {
      amount: money.format(Number(digits)),
      full: "от " + money.format(Number(digits)) + " ₽/мес."
    };
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Выделяет ключевые фразы выгод жирным внутри текста benefit
  function appendEmphasizedText(host, text) {
    var pattern = /(0,01%|в подарок|Выгода до\s+[\d\s\u00a0]+\s*₽)/gi;
    var last = 0;
    var match;
    while ((match = pattern.exec(text))) {
      if (match.index > last) {
        host.appendChild(document.createTextNode(text.slice(last, match.index)));
      }
      host.appendChild(el("strong", "catalog__benefit-em", match[0]));
      last = match.index + match[0].length;
    }
    if (last < text.length) {
      host.appendChild(document.createTextNode(text.slice(last)));
    }
  }

  function benefitItem(text) {
    var item = el("li", "catalog__benefit");
    item.appendChild(el("span", "catalog__benefit-mark", ""));
    var copy = el("span", "catalog__benefit-text");
    appendEmphasizedText(copy, text);
    item.appendChild(copy);
    return item;
  }

  // Тексты попапов для CTA каталога и комплектаций
  var leadCopy = {
    credit: {
      title: "Рассчитать кредит/лизинг",
      submit: "Рассчитать кредит",
      form: "credit"
    },
    book: {
      title: "Забронировать",
      submit: "Забронировать",
      form: "book"
    },
    leasing: {
      title: "Рассчитать кредит/лизинг",
      submit: "Купить в лизинг",
      form: "leasing"
    },
    offer: {
      title: "Получить предложение",
      submit: "Получить предложение",
      form: "offer"
    }
  };

  // Кнопка → data-* для общего попапа из main.js / forms.js
  function actionButton(label, popup, model, className) {
    var button = el("button", className, label);
    var copy = leadCopy[popup] || { title: label, submit: label, form: popup };
    button.type = "button";
    button.setAttribute("data-open-popup", "lead");
    button.setAttribute("data-form", copy.form);
    button.setAttribute("data-popup-title", copy.title);
    button.setAttribute("data-popup-text", "");
    button.setAttribute("data-popup-submit", copy.submit);
    button.setAttribute("data-model", model);
    return button;
  }

  // ——— FAMILIES (табы семейств) ———

  // Уникальные семейства в порядке первого появления в JSON
  function familyList(models) {
    var seen = {};
    var list = [];
    models.forEach(function (model) {
      if (!model.family || seen[model.family]) return;
      seen[model.family] = true;
      list.push({
        id: model.family,
        name: model.familyName || model.family,
        image: model.image || ""
      });
    });
    return list;
  }

  function familyModels(models, familyId) {
    return models.filter(function (model) {
      return model.family === familyId;
    });
  }

  // «ПАТРИОТ» / «ПРОФИ Бортовой…» → семейство в том же регистре, что в familyName
  function shortModelName(model) {
    var raw = String(model.name || "").replace(/^УАЗ\s+/i, "").trim();
    var family = model.familyName || "";
    if (family && new RegExp("^" + family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(raw)) {
      return raw.replace(new RegExp("^" + family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), family);
    }
    return raw || model.name;
  }

  // family / model / body — отдельные spans под вёрстку Spec Plate
  function modelTitleParts(model) {
    var family = model.familyName || model.family || "";
    var full = shortModelName(model);
    var body = full;
    if (family) {
      var re = new RegExp("^" + family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "i");
      if (re.test(full)) body = full.replace(re, "").trim();
    }
    return {
      family: family,
      model: family || full,
      body: body,
      full: full
    };
  }

  // Сумма выгоды: поле discount или парсинг из benefits
  function discountAmount(model) {
    if (model.discount > 0) return model.discount;
    var joined = (model.benefits || []).join(" ");
    var match = joined.match(/выгода до\s+([\d\s\u00a0]+)\s*₽/i);
    if (!match) return 0;
    return Number(String(match[1]).replace(/\D/g, "")) || 0;
  }

  function discountBadge(model) {
    var amount = discountAmount(model);
    if (!(amount > 0)) return null;
    var badge = el("span", "catalog__badge");
    badge.appendChild(el("span", "catalog__badge-label", "Выгода до"));
    badge.appendChild(el("span", "catalog__badge-value", formatPrice(amount)));
    return badge;
  }

  // ——— COLORS (сватчи: клик → смена фото) ———

  function modelColors(model) {
    if (model.colors && model.colors.length) return model.colors;
    if (model.image) {
      return [{ id: "default", name: model.name, hex: "#C3C4C4", image: model.image }];
    }
    return [];
  }

  function preloadColorImages(colors, startIndex) {
    colors.forEach(function (color, index) {
      if (index === startIndex || !color.image) return;
      var img = new Image();
      img.decoding = "async";
      img.src = color.image;
    });
  }

  function buildColors(model, photo) {
    var colors = modelColors(model);
    if (colors.length < 2) return null;

    var list = el("div", "catalog__colors");
    list.setAttribute("role", "radiogroup");
    list.setAttribute("aria-label", "Цвет кузова " + (model.name || ""));

    colors.forEach(function (color, index) {
      var swatch = el("button", "catalog__color" + (index === 0 ? " catalog__color--active" : ""));
      swatch.type = "button";
      swatch.setAttribute("role", "radio");
      swatch.setAttribute("aria-checked", index === 0 ? "true" : "false");
      swatch.setAttribute("aria-label", color.name || ("Цвет " + (index + 1)));
      swatch.style.background = color.hex || "#C3C4C4";
      if (color.border || String(color.hex || "").toUpperCase() === "#FFFFFF") {
        swatch.classList.add("catalog__color--light");
      }
      swatch.setAttribute("data-color-image", color.image || "");

      swatch.addEventListener("click", function () {
        if (!photo || !color.image || photo.getAttribute("src") === color.image) {
          Array.prototype.forEach.call(list.children, function (node) {
            var on = node === swatch;
            node.classList.toggle("catalog__color--active", on);
            node.setAttribute("aria-checked", on ? "true" : "false");
          });
          return;
        }
        Array.prototype.forEach.call(list.children, function (node) {
          var on = node === swatch;
          node.classList.toggle("catalog__color--active", on);
          node.setAttribute("aria-checked", on ? "true" : "false");
        });
        photo.classList.add("catalog__photo--swap");
        window.setTimeout(function () {
          photo.src = color.image;
          photo.alt = model.name + (color.name ? " — " + color.name : "");
          photo.classList.remove("catalog__photo--swap");
        }, prefersReducedMotion() ? 0 : 120);
      });

      list.appendChild(swatch);
    });

    preloadColorImages(colors, 0);
    return list;
  }

  // ——— SLIDE (карточка одной модели) ———

  function buildSlide(model) {
    var slide = el("article", "catalog__slide");
    slide.setAttribute("data-model-id", model.id);
    // aria-hidden / inert выставляет syncSlideA11y — иначе активный слайд
    // с кнопками получает aria-hidden="true" (PageSpeed Agent a11y).

    var body = el("div", "catalog__slide-body");
    var info = el("div", "catalog__info");

    var title = modelTitleParts(model);
    var head = el("div", "catalog__detail-head");
    var family = el("p", "catalog__detail-family");
    family.appendChild(el("span", "catalog__detail-family-label", "Семейство"));
    family.appendChild(el("span", "catalog__detail-family-name", title.family || title.model));
    head.appendChild(family);

    var name = el("h3", "catalog__detail-name");
    name.appendChild(el("span", "catalog__detail-model", title.model));
    if (title.body) {
      name.appendChild(document.createTextNode(" "));
      name.appendChild(el("span", "catalog__detail-body", title.body));
    }
    head.appendChild(name);
    info.appendChild(head);

    // «Выгода до» в списке не дублируем — она уже в badge на фото
    var benefits = el("ul", "catalog__benefits");
    var hasDiscount = discountAmount(model) > 0;
    (model.benefits || []).forEach(function (benefit) {
      if (hasDiscount && /выгода до/i.test(benefit)) return;
      benefits.appendChild(benefitItem(benefit));
    });
    info.appendChild(benefits);

    var media = el("div", "catalog__media");
    var badgeSlot = el("div", "catalog__badge-slot");
    var badge = discountBadge(model);
    if (badge) badgeSlot.appendChild(badge);
    media.appendChild(badgeSlot);

    var colors = modelColors(model);
    var startImage = (colors[0] && colors[0].image) || model.image;
    var photo = null;
    if (startImage) {
      photo = el("img", "catalog__photo");
      photo.src = startImage;
      photo.alt = model.name + (colors[0] && colors[0].name ? " — " + colors[0].name : "");
      photo.loading = "lazy";
      photo.decoding = "async";
      media.appendChild(photo);
      var colorList = buildColors(model, photo);
      if (colorList) media.appendChild(colorList);
    } else {
      media.appendChild(el("div", "catalog__placeholder"));
    }

    var deal = el("div", "catalog__deal");
    var summary = el("div", "catalog__summary");

    var offer = el("div", "catalog__offer");
    var prices = el("div", "catalog__prices");
    if (model.priceOld > model.price) {
      prices.appendChild(el("span", "catalog__old", formatPrice(model.priceOld)));
    }
    prices.appendChild(el("span", "catalog__price", formatPrice(model.price)));
    offer.appendChild(prices);
    summary.appendChild(offer);

    // Слот платежа всегда в разметке — иначе карточка прыгает по высоте
    var parts = paymentParts(model.payment);
    var pay = el("p", "catalog__payment" + (parts ? "" : " catalog__payment--empty"));
    if (parts) {
      pay.appendChild(el("span", "catalog__payment-prefix", "от"));
      pay.appendChild(document.createTextNode(" "));
      pay.appendChild(el("span", "catalog__payment-amount", parts.amount));
      pay.appendChild(document.createTextNode(" "));
      pay.appendChild(el("span", "catalog__payment-suffix", "₽/мес."));
    } else {
      pay.setAttribute("aria-hidden", "true");
      pay.appendChild(el("span", "catalog__payment-prefix", "от"));
      pay.appendChild(document.createTextNode(" "));
      pay.appendChild(el("span", "catalog__payment-amount", "0"));
      pay.appendChild(document.createTextNode(" "));
      pay.appendChild(el("span", "catalog__payment-suffix", "₽/мес."));
    }
    summary.appendChild(pay);
    deal.appendChild(summary);

    var actions = el("div", "catalog__actions");
    actions.appendChild(actionButton("Забронировать", "book", model.name, "button button--accent"));
    actions.appendChild(actionButton("Рассчитать кредит", "credit", model.name, "button button--line"));
    actions.appendChild(actionButton("Купить в лизинг", "leasing", model.name, "button button--accent"));
    deal.appendChild(actions);

    body.appendChild(el("div", "catalog__stage-glow", ""));
    body.appendChild(info);
    body.appendChild(media);
    body.appendChild(deal);
    slide.appendChild(body);
    return slide;
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function modelThumb(model) {
    if (model.colors && model.colors[0] && model.colors[0].image) return model.colors[0].image;
    return model.image || "";
  }

  function familyModIndex(familyId) {
    return modIndexByFamily[familyId] || 0;
  }

  // ——— FAMILY TABS (якоря → скролл к блоку семейства) ———

  function setActiveFamilyTab(familyId, host) {
    if (!host) host = document.querySelector("[data-catalog-families]");
    if (!host) return;
    activeFamily = familyId;
    Array.prototype.forEach.call(host.children, function (node) {
      var on = node.getAttribute("data-family-id") === familyId;
      node.classList.toggle("catalog__family--active", on);
      node.setAttribute("aria-selected", on ? "true" : "false");
      node.setAttribute("tabindex", on ? "0" : "-1");
    });
  }

  function scrollToFamilyBlock(familyId) {
    var block = document.getElementById("catalog-" + familyId);
    if (!block) return;
    scrollSpyPause = true;
    window.clearTimeout(scrollSpyTimer);
    block.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start"
    });
    scrollSpyTimer = window.setTimeout(function () {
      scrollSpyPause = false;
    }, prefersReducedMotion() ? 50 : 900);
  }

  function renderFamilies(models) {
    var host = document.querySelector("[data-catalog-families]");
    if (!host) return;
    host.replaceChildren();
    var families = familyList(models);
    if (!families.length) return;
    if (!activeFamily) activeFamily = families[0].id;

    families.forEach(function (family, index) {
      var selected = family.id === activeFamily;
      var button = el("button", "catalog__family" + (selected ? " catalog__family--active" : ""));
      button.type = "button";
      button.id = "catalog-family-tab-" + family.id;
      button.setAttribute("data-family-id", family.id);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.setAttribute("aria-controls", "catalog-" + family.id);
      button.setAttribute("tabindex", selected ? "0" : "-1");

      button.appendChild(el("span", "catalog__family-label", "Семейство"));
      button.appendChild(el("span", "catalog__family-name", family.name));
      if (family.image) {
        var photo = el("img", "catalog__family-photo");
        photo.src = family.image;
        photo.alt = "";
        photo.loading = index < 4 ? "eager" : "lazy";
        photo.decoding = "async";
        button.appendChild(photo);
      }

      button.addEventListener("click", function () {
        setActiveFamilyTab(family.id, host);
        scrollToFamilyBlock(family.id);
      });
      host.appendChild(button);
    });
  }

  // Подсветка таба при ручном скролле по столбику семейств
  function initFamilyScrollSpy() {
    if (familyObserver) {
      familyObserver.disconnect();
      familyObserver = null;
    }
    var blocks = document.querySelectorAll("[data-catalog-block]");
    if (!blocks.length || typeof IntersectionObserver !== "function") return;

    familyObserver = new IntersectionObserver(
      function (entries) {
        if (scrollSpyPause) return;
        var best = null;
        var bestRatio = 0;
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          if (entry.intersectionRatio >= bestRatio) {
            bestRatio = entry.intersectionRatio;
            best = entry.target;
          }
        });
        if (!best) return;
        var id = best.getAttribute("data-catalog-block");
        if (id && id !== activeFamily) setActiveFamilyTab(id);
      },
      {
        // «активная» зона у верхней трети экрана (ниже sticky header)
        root: null,
        rootMargin: "-18% 0px -55% 0px",
        threshold: [0.1, 0.25, 0.5, 0.75]
      }
    );

    Array.prototype.forEach.call(blocks, function (block) {
      familyObserver.observe(block);
    });
  }

  // ——— FAMILY BLOCK (карточка + лента модификаций) ———

  function syncSlideA11y(viewport, index) {
    if (!viewport) return;
    var slides = viewport.querySelectorAll(".catalog__slide");
    Array.prototype.forEach.call(slides, function (slide, i) {
      var on = i === index;
      slide.classList.toggle("catalog__slide--active", on);
      slide.classList.remove(
        "catalog__slide--entering",
        "catalog__slide--leaving",
        "catalog__slide--layer"
      );
      if (on) {
        slide.removeAttribute("aria-hidden");
        slide.removeAttribute("inert");
      } else {
        slide.setAttribute("aria-hidden", "true");
        slide.setAttribute("inert", "");
      }
    });
  }

  function clearSlideSwap(familyId) {
    if (!slideSwapTimers[familyId]) return;
    window.clearTimeout(slideSwapTimers[familyId]);
    slideSwapTimers[familyId] = 0;
  }

  function syncModsPeek(wrap) {
    if (!wrap) return;
    var track = wrap.querySelector("[data-catalog-mods-track]");
    var prev = wrap.querySelector("[data-catalog-mods-prev]");
    var next = wrap.querySelector("[data-catalog-mods-next]");
    if (!track) return;
    var max = track.scrollWidth - track.clientWidth;
    var overflow = max > 6;
    wrap.classList.toggle("catalog__mods--overflow", overflow);
    wrap.classList.toggle("catalog__mods--at-start", track.scrollLeft <= 2);
    wrap.classList.toggle("catalog__mods--at-end", track.scrollLeft >= max - 2);
    if (prev) prev.disabled = !overflow || track.scrollLeft <= 2;
    if (next) next.disabled = !overflow || track.scrollLeft >= max - 2;
  }

  function scrollActiveModIntoView(panel) {
    var active = panel && panel.querySelector(".catalog__mod--active");
    var track = panel && panel.querySelector("[data-catalog-mods-track]");
    if (!active || !track) return;

    // Не трогаем ленту, если активная модель уже целиком в кадре
    var trackRect = track.getBoundingClientRect();
    var btnRect = active.getBoundingClientRect();
    var pad = 12;
    if (btnRect.left >= trackRect.left + pad && btnRect.right <= trackRect.right - pad) {
      return;
    }

    var left = active.offsetLeft - (track.clientWidth - active.offsetWidth) / 2;
    track.scrollTo({
      left: Math.max(0, Math.min(left, track.scrollWidth - track.clientWidth)),
      behavior: prefersReducedMotion() ? "auto" : "smooth"
    });
  }

  function syncMods(panel, index) {
    if (!panel) return;
    var mods = panel.querySelectorAll("[data-catalog-mod]");
    Array.prototype.forEach.call(mods, function (btn, i) {
      var on = i === index;
      btn.classList.toggle("catalog__mod--active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });

    var wrap = panel.querySelector("[data-catalog-mods]");
    if (!wrap) return;
    window.requestAnimationFrame(function () {
      syncModsPeek(wrap);
      scrollActiveModIntoView(panel);
    });
  }

  function selectMod(panel, index) {
    if (!panel) return;
    var familyId = panel.getAttribute("data-catalog-block");
    var viewport = panel.querySelector("[data-catalog-viewport]");
    var slides = viewport && viewport.querySelectorAll(".catalog__slide");
    if (!slides || !slides.length) return;
    if (index < 0 || index >= slides.length) return;
    var current = familyModIndex(familyId);
    if (index === current && slides[index].classList.contains("catalog__slide--active")) {
      syncMods(panel, index);
      return;
    }

    var from = slides[current];
    var to = slides[index];
    modIndexByFamily[familyId] = index;
    syncMods(panel, index);

    // Без анимации / первый кадр / нет исходящего слайда
    if (prefersReducedMotion() || !from || !to || current === index) {
      clearSlideSwap(familyId);
      syncSlideA11y(viewport, index);
      lockViewportHeight(viewport, true);
      return;
    }

    clearSlideSwap(familyId);

    Array.prototype.forEach.call(slides, function (slide, i) {
      if (i === current || i === index) return;
      slide.classList.remove(
        "catalog__slide--active",
        "catalog__slide--entering",
        "catalog__slide--leaving",
        "catalog__slide--layer"
      );
      slide.setAttribute("aria-hidden", "true");
      slide.setAttribute("inert", "");
    });

    // from в потоке (высота), to — слой сверху с opacity 0
    from.classList.add("catalog__slide--active");
    from.classList.remove("catalog__slide--entering", "catalog__slide--layer");
    to.classList.add("catalog__slide--active", "catalog__slide--layer", "catalog__slide--entering");
    to.classList.remove("catalog__slide--leaving");
    to.removeAttribute("aria-hidden");
    to.removeAttribute("inert");
    from.setAttribute("aria-hidden", "true");
    from.setAttribute("inert", "");

    // Двойной rAF: Safari успевает отрисовать opacity:0 до fade-in
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        from.classList.add("catalog__slide--leaving");
        to.classList.remove("catalog__slide--entering");
      });
    });

    slideSwapTimers[familyId] = window.setTimeout(function () {
      slideSwapTimers[familyId] = 0;
      syncSlideA11y(viewport, index);
      lockViewportHeight(viewport, true);
    }, SLIDE_FADE_MS);
  }

  function buildModsShell(track) {
    var shell = el("div", "catalog__mods-shell");
    var prev = el("button", "catalog__mods-arrow catalog__mods-arrow--prev");
    prev.type = "button";
    prev.setAttribute("data-catalog-mods-prev", "");
    prev.setAttribute("aria-label", "Предыдущие модификации");
    prev.innerHTML = "<span aria-hidden=\"true\"></span>";

    var scroller = el("div", "catalog__mods-scroller");
    scroller.appendChild(track);

    var next = el("button", "catalog__mods-arrow catalog__mods-arrow--next");
    next.type = "button";
    next.setAttribute("data-catalog-mods-next", "");
    next.setAttribute("aria-label", "Следующие модификации");
    next.innerHTML = "<span aria-hidden=\"true\"></span>";

    shell.appendChild(prev);
    shell.appendChild(scroller);
    shell.appendChild(next);

    prev.addEventListener("click", function () {
      track.scrollBy({
        left: -Math.max(180, track.clientWidth * 0.7),
        behavior: prefersReducedMotion() ? "auto" : "smooth"
      });
    });
    next.addEventListener("click", function () {
      track.scrollBy({
        left: Math.max(180, track.clientWidth * 0.7),
        behavior: prefersReducedMotion() ? "auto" : "smooth"
      });
    });
    track.addEventListener("scroll", function () {
      syncModsPeek(shell.parentElement);
    }, { passive: true });

    return shell;
  }

  // Peek-лента: fade по краям + стрелки при переполнении
  function buildMods(visible, familyName, activeMod) {
    var wrap = el("div", "catalog__mods");
    wrap.setAttribute("data-catalog-mods", "");

    var title = el("p", "catalog__mods-title");
    title.appendChild(el("strong", "catalog__mods-brand", "УАЗ " + (familyName || "")));
    wrap.appendChild(title);

    var track = el("div", "catalog__mods-track");
    track.setAttribute("data-catalog-mods-track", "");
    track.setAttribute("role", "group");
    track.setAttribute("aria-label", "Модификации " + (familyName || ""));

    visible.forEach(function (model, index) {
      var btn = el("button", "catalog__mod" + (index === activeMod ? " catalog__mod--active" : ""));
      btn.type = "button";
      btn.setAttribute("data-catalog-mod", model.id);
      btn.setAttribute("aria-pressed", index === activeMod ? "true" : "false");

      var thumb = modelThumb(model);
      if (thumb) {
        var photo = el("img", "catalog__mod-photo");
        photo.src = thumb;
        photo.alt = "";
        photo.loading = "lazy";
        photo.decoding = "async";
        btn.appendChild(photo);
      }
      btn.appendChild(el("span", "catalog__mod-name", shortModelName(model)));
      btn.addEventListener("click", function () {
        selectMod(wrap.closest("[data-catalog-block]"), index);
      });
      track.appendChild(btn);
    });

    wrap.appendChild(buildModsShell(track));
    return wrap;
  }

  // Один блок семейства: стек карточек + лента модификаций
  function buildFamilyBlock(family, visible) {
    var activeMod = familyModIndex(family.id);
    if (activeMod >= visible.length) {
      activeMod = 0;
      modIndexByFamily[family.id] = 0;
    }

    var panel = el("article", "catalog__panel");
    panel.id = "catalog-" + family.id;
    panel.setAttribute("data-catalog-block", family.id);
    panel.setAttribute("aria-labelledby", "catalog-family-tab-" + family.id);

    var viewport = el("div", "catalog__viewport");
    viewport.setAttribute("data-catalog-viewport", "");

    visible.forEach(function (model, index) {
      var slide = buildSlide(model);
      if (index === activeMod) slide.classList.add("catalog__slide--active");
      viewport.appendChild(slide);
    });
    panel.appendChild(viewport);

    if (visible.length > 1) {
      panel.appendChild(buildMods(visible, family.name, activeMod));
    }

    syncSlideA11y(viewport, activeMod);
    return { panel: panel, viewport: viewport };
  }

  // Все семейства столбиком
  function renderStage(models) {
    var stage = document.querySelector("[data-catalog-stage]");
    if (!stage) return;
    stage.removeAttribute("role");
    stage.replaceChildren();

    var families = familyList(models);
    if (!families.length) {
      stage.appendChild(el("p", "catalog__risk", "Модельный ряд пока пуст."));
      return;
    }

    families.forEach(function (family) {
      var visible = familyModels(models, family.id);
      if (!visible.length) return;
      var built = buildFamilyBlock(family, visible);
      stage.appendChild(built.panel);
      lockViewportHeight(built.viewport);
    });

    initFamilyScrollSpy();
  }

  // ——— HEIGHT LOCK ———
  // Фиксируем высоту viewport (--catalog-stage-h):
  // • mobile — по самому высокому слайду семейства (кнопки всегда внизу);
  // • ≥768 — по активному слайду.

  function isCatalogCompact() {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  function lockViewportHeight(viewport, fromImage) {
    if (!viewport) return;

    // ≥768: высота по контенту, без внутреннего скролла карточки
    if (!isCatalogCompact()) {
      viewport.style.removeProperty("--catalog-stage-h");
      viewport.style.height = "auto";
      viewport.style.minHeight = "0";
      if (fromImage) return;
      Array.prototype.forEach.call(viewport.querySelectorAll("img"), function (img) {
        if (img.complete) return;
        img.addEventListener("load", function () {
          lockViewportHeight(viewport, true);
        }, { once: true });
      });
      return;
    }

    // Mobile: меряем, не сбрасывая текущую высоту — иначе Safari мигает при scroll/resize
    var slides = viewport.querySelectorAll(".catalog__slide");
    var max = 0;
    Array.prototype.forEach.call(slides, function (slide) {
      slide.classList.add("catalog__slide--measure");
      max = Math.max(max, slide.scrollHeight || slide.offsetHeight);
      slide.classList.remove("catalog__slide--measure");
    });

    if (max > 0) {
      var next = max + "px";
      if (viewport.style.height !== next) {
        viewport.style.setProperty("--catalog-stage-h", next);
        viewport.style.height = next;
        viewport.style.minHeight = next;
      }
    }

    if (fromImage) return;
    Array.prototype.forEach.call(viewport.querySelectorAll("img"), function (img) {
      if (img.complete) return;
      img.addEventListener("load", function () {
        lockViewportHeight(viewport, true);
      }, { once: true });
    });
  }

  function refreshActiveCatalogViewport() {
    var stage = document.querySelector("[data-catalog-stage]");
    if (!stage) return;
    Array.prototype.forEach.call(stage.querySelectorAll("[data-catalog-viewport]"), function (viewport) {
      lockViewportHeight(viewport, true);
    });
  }

  // ——— TRIMS (блок «Комплектации») ———
  // Табы моделей → список комплектаций → карточка с фото/спеками/ценой/CTA

  function renderTrims(models) {
    var tabs = document.querySelector("[data-trim-tabs]");
    var list = document.querySelector("[data-trim-list]");
    var card = document.querySelector("[data-trim-card]");
    if (!tabs || !list || !card || !models.length) return;

    var current = 0;
    var trimIndex = 0;

    models.forEach(function (model, index) {
      var tab = el("button", "trims__tab" + (index === 0 ? " trims__tab--active" : ""), model.name.replace(/^УАЗ\s+/i, ""));
      tab.type = "button";
      tab.id = "trim-tab-" + model.id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "trim-panel");
      tab.setAttribute("aria-selected", index === 0 ? "true" : "false");
      tab.setAttribute("tabindex", index === 0 ? "0" : "-1");
      tab.addEventListener("click", function () {
        current = index;
        trimIndex = 0;
        paint();
      });
      tabs.appendChild(tab);
    });

    // Перерисовать список комплектаций и карточку под выбранную модель
    function paint() {
      var model = models[current];
      var panel = document.getElementById("trim-panel");
      Array.prototype.forEach.call(tabs.children, function (tab, index) {
        var selected = index === current;
        tab.classList.toggle("trims__tab--active", selected);
        tab.setAttribute("aria-selected", selected ? "true" : "false");
        tab.setAttribute("tabindex", selected ? "0" : "-1");
        if (selected && panel) panel.setAttribute("aria-labelledby", tab.id);
      });
      list.replaceChildren();
      model.trims.forEach(function (trim, index) {
        var option = el("button", "trims__option" + (index === trimIndex ? " trims__option--active" : ""), trim.name);
        option.type = "button";
        option.setAttribute("aria-pressed", index === trimIndex ? "true" : "false");
        option.addEventListener("click", function () {
          trimIndex = index;
          paintCard(model, model.trims[trimIndex]);
          Array.prototype.forEach.call(list.children, function (node, nodeIndex) {
            var selected = nodeIndex === trimIndex;
            node.classList.toggle("trims__option--active", selected);
            node.setAttribute("aria-pressed", selected ? "true" : "false");
          });
        });
        list.appendChild(option);
      });
      paintCard(model, model.trims[trimIndex]);
    }

    function modelPhoto(model) {
      if (model.colors && model.colors[0] && model.colors[0].image) return model.colors[0].image;
      return model.image || "";
    }

    // Правая карточка: фото модели + параметры выбранной комплектации
    function paintCard(model, trim) {
      card.replaceChildren();
      var media = el("div", "trims__media");
      var src = modelPhoto(model);
      if (src) {
        var photo = el("img", "trims__photo");
        photo.src = src;
        photo.alt = model.name;
        photo.loading = "lazy";
        photo.decoding = "async";
        media.appendChild(photo);
      } else {
        media.appendChild(el("div", "trims__placeholder"));
      }
      card.appendChild(media);
      var body = el("div", "trims__body");
      body.appendChild(el("p", "trims__kicker", model.name));
      body.appendChild(el("h3", "trims__name", trim.name));
      var specs = el("ul", "trims__specs");
      [
        ["Мощность", trim.hp],
        ["Трансмиссия", trim.gear]
      ].forEach(function (row) {
        if (!row[1]) return;
        var item = el("li", "trims__spec");
        item.appendChild(el("span", "trims__spec-name", row[0]));
        item.appendChild(el("span", "trims__spec-value", row[1]));
        specs.appendChild(item);
      });
      body.appendChild(specs);
      if (trim.discount > 0) {
        body.appendChild(el("p", "trims__benefit", "Выгода до " + formatPrice(trim.discount)));
      }
      var prices = el("div", "trims__prices");
      if (trim.priceOld > trim.price) {
        prices.appendChild(el("span", "trims__old", formatPrice(trim.priceOld)));
      }
      prices.appendChild(el("span", "trims__price", formatPrice(trim.price)));
      body.appendChild(prices);
      var actions = el("div", "trims__actions");
      actions.appendChild(actionButton("Получить предложение", "offer", model.name + " " + trim.name, "button button--accent"));
      actions.appendChild(actionButton("Рассчитать кредит", "credit", model.name + " " + trim.name, "button button--line"));
      body.appendChild(actions);
      card.appendChild(body);
    }

    paint();
  }

  // ——— BOOT ———

  // Drag-scroll ленты: скролл только после порога, иначе клик выбирает модель
  function enableModsDragScroll(track) {
    if (!track || track.getAttribute("data-drag-ready")) return;
    track.setAttribute("data-drag-ready", "1");
    var pressing = false;
    var dragging = false;
    var startX = 0;
    var startScroll = 0;
    var threshold = 8;

    track.addEventListener("mousedown", function (event) {
      if (event.button !== 0) return;
      pressing = true;
      dragging = false;
      startX = event.clientX;
      startScroll = track.scrollLeft;
    });

    window.addEventListener("mousemove", function (event) {
      if (!pressing) return;
      var dx = event.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < threshold) return;
        dragging = true;
        track.classList.add("catalog__mods-track--dragging");
      }
      track.scrollLeft = startScroll - dx;
    });

    window.addEventListener("mouseup", function () {
      if (!pressing) return;
      pressing = false;
      track.classList.remove("catalog__mods-track--dragging");
      // dragging сбрасываем на следующем тике — после click capture
      window.setTimeout(function () {
        dragging = false;
      }, 0);
    });

    track.addEventListener("click", function (event) {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  // iOS Safari шлёт resize при скрытии/показе адресной строки — игнорим смену только высоты
  var resizeTimer = 0;
  var lastCatalogWidth = window.innerWidth;
  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      var width = window.innerWidth;
      if (width === lastCatalogWidth) return;
      lastCatalogWidth = width;
      refreshActiveCatalogViewport();
    }, 150);
  });

  function enhanceModsUi() {
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-catalog-mods-track]"),
      enableModsDragScroll
    );
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-catalog-mods]"),
      syncModsPeek
    );
  }

  fetch("data/catalog.json")
    .then(function (response) {
      if (!response.ok) throw new Error("catalog");
      return response.json();
    })
    .then(function (models) {
      allModels = models || [];
      renderFamilies(allModels);
      renderStage(allModels);
      renderTrims(allModels);
      enhanceModsUi();
    })
    .catch(function () {
      var stage = document.querySelector("[data-catalog-stage]");
      if (stage) stage.appendChild(el("p", "catalog__risk", "Не удалось загрузить модельный ряд."));
    });
})();
