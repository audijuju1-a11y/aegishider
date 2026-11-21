(function () {
  "use strict";
  document.documentElement.classList.remove("no-js");

  var nav = document.getElementById("siteNav");
  var toggle = document.getElementById("navToggle");
  if (nav && toggle) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  var themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("bh-theme", next); } catch (error) { /* storage unavailable */ }
    });
  }

  document.querySelectorAll("[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      var message = form.getAttribute("data-confirm") || "ยืนยันการทำรายการ?";
      if (!window.confirm(message)) event.preventDefault();
    });
  });

  document.querySelectorAll("form[data-lock]").forEach(function (form) {
    form.addEventListener("submit", function () {
      setTimeout(function () {
        form.querySelectorAll("button[type=submit]").forEach(function (button) {
          button.disabled = true;
        });
      }, 10);
    });
  });

  if (navigator.clipboard) {
    document.querySelectorAll("[data-copy]").forEach(function (button) {
      button.addEventListener("click", function () {
        var value = button.getAttribute("data-copy") || "";
        navigator.clipboard.writeText(value).then(function () {
          var label = button.textContent;
          button.textContent = "คัดลอกแล้ว";
          setTimeout(function () { button.textContent = label; }, 1600);
        }).catch(function () { /* ignore */ });
      });
    });
  }

  document.querySelectorAll("[data-auto-dismiss]").forEach(function (node) {
    setTimeout(function () {
      node.style.opacity = "0";
      setTimeout(function () { node.hidden = true; }, 400);
    }, 6000);
  });
})();
