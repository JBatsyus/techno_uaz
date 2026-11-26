(function () {
    var header = document.querySelector(".header");
    var burger = document.querySelector(".header__burger");
    var nav = document.querySelector(".nav");

    if (burger && header && nav) {
        function closeMenu() {
            header.classList.remove("header--open");
            burger.setAttribute("aria-expanded", "false");
            burger.setAttribute("aria-label", "Открыть меню");
        }

        function scrollToSection(target, hash) {
            window.requestAnimationFrame(function () {
                var root = document.documentElement;
                var top = target.getBoundingClientRect().top + window.scrollY - header.offsetHeight;
                if (top < 0) top = 0;
                var motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                var previous = root.style.scrollBehavior;
                root.style.scrollBehavior = "auto";
                window.scrollTo({
                    top: top,
                    behavior: motion ? "smooth" : "auto"
                });
                root.style.scrollBehavior = previous;
                if (hash && window.history && history.pushState) history.pushState(null, "", hash);
            });
        }

        burger.addEventListener("click", function () {
            var open = header.classList.toggle("header--open");
            burger.setAttribute("aria-expanded", open ? "true" : "false");
            burger.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
        });

        nav.addEventListener("click", function (event) {
            var link = event.target.closest(".nav__link");
            if (link) {
                var hash = link.getAttribute("href") || "";
                var target = hash.charAt(0) === "#" ? document.querySelector(hash) : null;
                if (target) {
                    event.preventDefault();
                    if (link.blur) link.blur();
                    closeMenu();
                    scrollToSection(target, hash);
                    return;
                }
            }
            if (event.target.closest("[data-open-popup]")) closeMenu();
        });

        window.addEventListener("popstate", function () {
            if (!location.hash) return;
            var target = document.querySelector(location.hash);
            if (!target) return;
            closeMenu();
            scrollToSection(target);
        });

        document.addEventListener("click", function (event) {
            if (!header.classList.contains("header--open")) return;
            if (event.target.closest(".nav, .header__burger")) return;
            closeMenu();
        });
    }

    if (header) {
        function syncHeaderOffset() {
            document.documentElement.style.setProperty("--header-offset", header.offsetHeight + "px");
        }

        syncHeaderOffset();
        window.addEventListener("resize", syncHeaderOffset);

        header.addEventListener("mousedown", function (event) {
            if (event.button !== 0) return;
            if (!event.target.closest("[data-open-popup]")) return;
            var scrollY = window.scrollY;
            event.preventDefault();

            function keepPlace() {
                if (window.scrollY === scrollY) return;
                var root = document.documentElement;
                var previous = root.style.scrollBehavior;
                root.style.scrollBehavior = "auto";
                window.scrollTo(0, scrollY);
                root.style.scrollBehavior = previous;
            }
            window.addEventListener("scroll", keepPlace);
            window.requestAnimationFrame(function () {
                window.removeEventListener("scroll", keepPlace);
                keepPlace();
            });
        });
    }

    var cookie = document.querySelector(".cookie");
    if (cookie && !localStorage.getItem("uaz-cookie")) {
        cookie.classList.add("cookie--open");
        cookie.removeAttribute("aria-hidden");
        cookie.removeAttribute("inert");
    }

    var cookieButton = document.querySelector("[data-cookie-accept]");
    if (cookieButton && cookie) {
        cookieButton.addEventListener("click", function () {
            localStorage.setItem("uaz-cookie", "1");
            cookie.classList.remove("cookie--open");
            cookie.setAttribute("aria-hidden", "true");
            cookie.setAttribute("inert", "");
        });
    }

    // Срок акции. Меняется только эта строка.
    // null — конец текущего месяца, 23:59:59.
    //        Когда время выйдет, срок сам сдвинется на конец следующего месяца.
    // Своя дата — new Date(год, месяц, день, часы, минуты, секунды).
    // Месяц считается с нуля: январь 0, октябрь 9, декабрь 11.
    // null — до конца текущего месяца (по ТЗ, шаг месяц)
    var PROMO_END = null;

    // Последний день текущего месяца, 23:59:59.
    function endOfMonth() {
        var now = new Date();
        var end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 0);
        if (end.getTime() <= now.getTime()) {
            end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 0);
        }
        return end;
    }

    var deadline = PROMO_END || endOfMonth();
    var timerNodes = {
        days: document.querySelector("[data-timer='days']"),
        hours: document.querySelector("[data-timer='hours']"),
        minutes: document.querySelector("[data-timer='minutes']"),
        seconds: document.querySelector("[data-timer='seconds']")
    };

    function pad(value) {
        return String(value).padStart(2, "0");
    }

    function paint(node, value) {
        if (!node) return;
        var text = pad(value).slice(-2);
        var digits = node.querySelectorAll(".timer__digit");
        if (digits.length < 2) return;
        digits[0].textContent = text.charAt(0);
        digits[1].textContent = text.charAt(1);
    }

    function tick() {
        var diff = deadline.getTime() - Date.now();

        // Свой срок закончился — оставляем нули и больше не перезапускаем.
        // Месячный срок (PROMO_END = null) после нуля начинается заново.
        if (diff <= 0 && PROMO_END) {
            paint(timerNodes.days, 0);
            paint(timerNodes.hours, 0);
            paint(timerNodes.minutes, 0);
            paint(timerNodes.seconds, 0);
            return;
        }
        if (diff <= 0) {
            deadline = endOfMonth();
            diff = deadline.getTime() - Date.now();
        }

        var total = Math.floor(diff / 1000);
        paint(timerNodes.days, Math.floor(total / 86400));
        paint(timerNodes.hours, Math.floor((total % 86400) / 3600));
        paint(timerNodes.minutes, Math.floor((total % 3600) / 60));
        paint(timerNodes.seconds, total % 60);
    }

    if (timerNodes.days) {
        tick();
        window.setInterval(tick, 1000);
    }

    var lastFocus = null;

    function openPopup(id, model, opener) {
        var popup = document.getElementById("popup-" + id);
        if (!popup) return;
        if (opener) {
            var title = popup.querySelector("[data-popup-title]");
            var text = popup.querySelector("[data-popup-text]");
            var submit = popup.querySelector("[data-popup-submit]");
            var form = popup.querySelector("[data-form]");
            if (title) title.textContent = opener.getAttribute("data-popup-title") || title.textContent;
            if (text) {
                var note = opener.getAttribute("data-popup-text") || "";
                text.textContent = note;
                text.hidden = !note;
            }
            if (submit) submit.textContent = opener.getAttribute("data-popup-submit") || submit.textContent;
            if (form) {
                form.setAttribute("data-form", opener.getAttribute("data-form") || "lead");
                form.reset();
                form.classList.remove("form--invalid");
                Array.prototype.forEach.call(form.querySelectorAll("[aria-invalid]"), function (field) {
                    field.removeAttribute("aria-invalid");
                    field.removeAttribute("aria-describedby");
                });
            }
        }
        var modelNode = popup.querySelector("[data-popup-model]");
        var modelInput = popup.querySelector("[name='model']");
        if (modelNode) {
            modelNode.textContent = model || "";
            modelNode.hidden = !model;
        }
        if (modelInput) modelInput.value = model || "";
        lastFocus = document.activeElement;
        var gap = window.innerWidth - document.documentElement.clientWidth;
        document.documentElement.style.setProperty("--scrollbar-gap", gap + "px");
        document.body.classList.add("is-locked");
        popup.classList.add("popup--open");
        popup.setAttribute("aria-hidden", "false");
        popup.removeAttribute("inert");
        var close = popup.querySelector(".popup__close");
        if (close) close.focus({
            preventScroll: true
        });
    }

    function closePopup(popup) {
        popup.classList.remove("popup--open");
        popup.setAttribute("aria-hidden", "true");
        popup.setAttribute("inert", "");
        if (!document.querySelector(".popup--open")) {
            document.body.classList.remove("is-locked");
            document.documentElement.style.removeProperty("--scrollbar-gap");
        }
        if (lastFocus && lastFocus.focus) lastFocus.focus({
            preventScroll: true
        });
    }

    document.addEventListener("click", function (event) {
        var opener = event.target.closest("[data-open-popup]");
        if (opener) {
            event.preventDefault();
            openPopup(opener.getAttribute("data-open-popup"), opener.getAttribute("data-model") || "", opener);
            return;
        }
        if (event.target.closest("[data-close-popup]")) {
            var popup = event.target.closest(".popup");
            if (popup) closePopup(popup);
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") return;
        var opened = document.querySelector(".popup--open");
        if (opened) closePopup(opened);
    });

    var ticker = document.querySelector(".ticker");
    var track = document.querySelector(".ticker__track");
    var source = track && track.querySelector(".ticker__group");
    if (ticker && track && source) {
        var seed = Array.prototype.map.call(source.children, function (item) {
            return item.cloneNode(true);
        });

        function fillTicker() {
            source.replaceChildren();
            var guard = 0;
            do {
                seed.forEach(function (item) {
                    source.appendChild(item.cloneNode(true));
                });
                guard += 1;
            } while (source.scrollWidth < ticker.clientWidth && guard < 12);

            var copy = source.cloneNode(true);
            copy.setAttribute("aria-hidden", "true");
            track.replaceChildren(source, copy);
        }

        fillTicker();
        window.addEventListener("resize", fillTicker);
    }

    // Колесо мыши сглаживается. Якоря по-прежнему идут через scroll-behavior: smooth.
    // Тач, клавиатура и списки со своей прокруткой остаются нативными.
    var motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (motionOk) {
        var scrollTarget = window.scrollY;
        var scrollNow = window.scrollY;
        var scrollFrame = 0;

        function scrollLimit() {
            return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        }

        function hasOwnScroll(node) {
            while (node && node !== document.body && node !== document.documentElement) {
                var style = window.getComputedStyle(node);
                var canScroll = style.overflowY === "auto" || style.overflowY === "scroll";
                if (canScroll && node.scrollHeight > node.clientHeight + 1) return true;
                node = node.parentElement;
            }
            return false;
        }

        function stepScroll() {
            var gap = scrollTarget - scrollNow;
            if (Math.abs(gap) < 0.5) {
                scrollNow = scrollTarget;
                scrollFrame = 0;
            } else {
                scrollNow += gap * 0.18;
                scrollFrame = window.requestAnimationFrame(stepScroll);
            }
            var root = document.documentElement;
            var previous = root.style.scrollBehavior;
            root.style.scrollBehavior = "auto";
            window.scrollTo(0, scrollNow);
            root.style.scrollBehavior = previous;
        }

        window.addEventListener("wheel", function (event) {
            if (document.body.classList.contains("is-locked")) return;
            if (!event.deltaY || hasOwnScroll(event.target)) return;
            event.preventDefault();
            var delta = event.deltaY;
            if (event.deltaMode === 1) delta *= 16;
            if (event.deltaMode === 2) delta *= window.innerHeight;
            if (!scrollFrame) scrollNow = window.scrollY;
            scrollTarget = Math.min(scrollLimit(), Math.max(0, (scrollFrame ? scrollTarget : window.scrollY) + delta));
            if (!scrollFrame) scrollFrame = window.requestAnimationFrame(stepScroll);
        }, {
            passive: false
        });

        window.addEventListener("scroll", function () {
            if (scrollFrame) return;
            scrollNow = window.scrollY;
            scrollTarget = scrollNow;
        }, {
            passive: true
        });
    }

    function enableDragScroll(scroller, draggingClass) {
        if (!scroller) return;

        var active = false;
        var dragged = false;
        var startX = 0;
        var startScroll = 0;
        var threshold = 6;

        scroller.addEventListener("mousedown", function (event) {
            if (event.button !== 0) return;
            active = true;
            dragged = false;
            startX = event.clientX;
            startScroll = scroller.scrollLeft;
        });

        window.addEventListener("mousemove", function (event) {
            if (!active) return;
            var dx = event.clientX - startX;
            if (!dragged && Math.abs(dx) < threshold) return;
            dragged = true;
            scroller.classList.add(draggingClass);
            scroller.scrollLeft = startScroll - dx;
            event.preventDefault();
        });

        function endDrag() {
            if (!active) return;
            active = false;
            scroller.classList.remove(draggingClass);
        }

        window.addEventListener("mouseup", endDrag);
        window.addEventListener("blur", endDrag);

        scroller.addEventListener("click", function (event) {
            if (!dragged) return;
            event.preventDefault();
            event.stopPropagation();
            dragged = false;
        }, true);
    }

    enableDragScroll(document.querySelector("[data-trim-tabs]"), "trims__tabs--dragging");
    enableDragScroll(document.querySelector("[data-catalog-families]"), "catalog__families--dragging");

    window.Uaz = {
        openPopup: openPopup,
        closePopup: closePopup
    };
})();