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

  document.querySelectorAll("input[type=password]").forEach(function (input) {
    input.setAttribute("data-password-input", "");
  });
  document.querySelectorAll("[data-toggle-password]").forEach(function (toggle) {
    toggle.addEventListener("change", function () {
      var scope = toggle.closest("form") || document;
      scope.querySelectorAll("[data-password-input]").forEach(function (input) {
        input.type = toggle.checked ? "text" : "password";
      });
    });
  });

  var docSearch = document.querySelector("[data-doc-search]");
  if (docSearch) {
    docSearch.addEventListener("input", function () {
      var query = docSearch.value.trim().toLowerCase();
      document.querySelectorAll("[data-doc-group]").forEach(function (group) {
        var visible = 0;
        group.querySelectorAll("[data-doc-item]").forEach(function (item) {
          var match = !query || (item.getAttribute("data-search") || "").toLowerCase().includes(query);
          item.hidden = !match;
          if (match) visible++;
        });
        group.hidden = visible === 0;
      });
    });
  }

  var buildSelect = document.querySelector("[data-build-select]");
  if (buildSelect) {
    var buildDownload = document.querySelector("[data-build-download]");
    var buildVersion = document.querySelector("[data-build-version]");
    var buildDate = document.querySelector("[data-build-date]");
    var buildRange = document.querySelector("[data-build-range]");
    var buildJava = document.querySelector("[data-build-java]");
    var buildSize = document.querySelector("[data-build-size]");
    var buildSha = document.querySelector("[data-build-sha]");
    var buildCopy = document.querySelector("[data-build-copy]");
    var syncBuild = function () {
      var option = buildSelect.options[buildSelect.selectedIndex];
      if (!option) return;
      if (buildDownload && option.dataset.url) buildDownload.setAttribute("href", option.dataset.url);
      if (buildVersion && option.dataset.version) buildVersion.textContent = "v" + option.dataset.version;
      if (buildDate && option.dataset.date) buildDate.textContent = option.dataset.date;
      if (buildRange && option.dataset.range) buildRange.textContent = option.dataset.range;
      if (buildJava && option.dataset.java) buildJava.textContent = option.dataset.java;
      if (buildSize && option.dataset.size) buildSize.textContent = option.dataset.size;
      if (buildSha) buildSha.textContent = option.dataset.sha || "—";
      if (buildCopy) {
        buildCopy.setAttribute("data-copy", option.dataset.sha || "");
        buildCopy.hidden = !option.dataset.sha;
      }
    };
    buildSelect.addEventListener("change", syncBuild);
    syncBuild();
  }

  if (navigator.clipboard) {
    document.querySelectorAll("pre").forEach(function (pre) {
      if (pre.closest("[data-no-copy]") || !pre.innerText.trim()) return;
      var wrapper = document.createElement("div");
      wrapper.className = "code-block-wrap";
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-ghost btn-sm code-copy";
      button.textContent = "คัดลอกโค้ด";
      button.setAttribute("data-copy", pre.innerText);
      wrapper.appendChild(button);
    });
  }

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
