/**
 * PragmaSearch drop-in widget — a self-contained, dependency-free search UI.
 * Point it at a PragmaSearch server and it renders a search box, faceted
 * refinement sidebar, highlighted results and pagination.
 *
 * Usage:
 *   <link rel="stylesheet" href="pragmasearch-widget.css">
 *   <div id="search"></div>
 *   <script src="pragmasearch-widget.js"></script>
 *   <script>PragmaSearch.create({ container: "#search", endpoint: "https://search.yoursite.com" });</script>
 */
(function () {
  "use strict";

  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u == null ? "" : u)) ? String(u) : ""; }
  function el(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }

  var PRICE_RANGES = [
    { label: "Under 100", lte: 100 },
    { label: "100 – 500", gte: 100, lte: 500 },
    { label: "500 – 1000", gte: 500, lte: 1000 },
    { label: "1000+", gte: 1000 },
  ];

  function create(options) {
    options = options || {};
    var root = typeof options.container === "string" ? document.querySelector(options.container) : options.container;
    if (!root) throw new Error("PragmaSearch: container not found");
    var endpoint = (options.endpoint || "").replace(/\/$/, "");
    var facetFields = options.facets || ["category", "brand"];
    var PER = options.hitsPerPage || 12;
    var placeholder = options.placeholder || "Search…";
    var showPrice = options.priceFacet !== false;
    var poweredBy = options.poweredBy !== false;
    var renderHit = options.renderHit;

    root.classList.add("ps-root");
    root.innerHTML =
      '<div class="ps-searchbar">' +
      '<svg class="ps-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
      '<input class="ps-input" type="text" autocomplete="off" placeholder="' + esc(placeholder) + '">' +
      '<div class="ps-suggest" hidden></div></div>' +
      '<div class="ps-layout"><aside class="ps-facets" hidden></aside>' +
      '<div><div class="ps-hits"></div><div class="ps-empty"></div><div class="ps-pager" hidden></div>' +
      (poweredBy ? '<div class="ps-poweredby">powered by <a href="https://github.com/wemaxie/PragmaSearch" target="_blank" rel="noopener">PragmaSearch</a></div>' : "") +
      "</div></div>";

    var input = root.querySelector(".ps-input");
    var suggestEl = root.querySelector(".ps-suggest");
    var facetsEl = root.querySelector(".ps-facets");
    var hitsEl = root.querySelector(".ps-hits");
    var emptyEl = root.querySelector(".ps-empty");
    var pagerEl = root.querySelector(".ps-pager");

    var offset = 0;
    var refine = {}; facetFields.forEach(function (f) { refine[f] = new Set(); });
    var priceRange = null;
    var titles = [];
    var sgItems = [], sgActive = -1;
    var timer, ctrl;

    // ---- autocomplete data (optional) ----
    fetch(endpoint + "/api/titles").then(function (r) { return r.json(); })
      .then(function (d) { titles = (d && d.items) || []; }).catch(function () {});

    function buildFilter() {
      var f = {};
      facetFields.forEach(function (field) { if (refine[field].size) f[field] = Array.from(refine[field]); });
      if (priceRange) f.price = priceRange;
      return Object.keys(f).length ? f : null;
    }

    // ---- suggestions ----
    function renderSuggest(raw) {
      var q = raw.trim().toLowerCase();
      sgItems = []; sgActive = -1;
      if (q && titles.length) {
        var starts = [], incl = [];
        for (var i = 0; i < titles.length && starts.length < 7; i++) {
          var nt = (titles[i].title || "").toLowerCase();
          if (nt.indexOf(q) === 0) starts.push(titles[i]);
          else if (nt.indexOf(q) > -1 && incl.length < 7) incl.push(titles[i]);
        }
        sgItems = starts.concat(incl).slice(0, 7);
      }
      if (!sgItems.length) { suggestEl.hidden = true; suggestEl.innerHTML = ""; return; }
      suggestEl.innerHTML = sgItems.map(function (t, i) {
        var img = safeUrl(t.image);
        var thumb = img ? '<img class="ps-sg-thumb" src="' + esc(img) + '" loading="lazy" onerror="this.style.display=\'none\'">' : "";
        return '<div class="ps-sg" data-i="' + i + '">' + thumb + '<span class="ps-sg-title">' + esc(t.title) + "</span></div>";
      }).join("");
      suggestEl.hidden = false;
      Array.prototype.forEach.call(suggestEl.querySelectorAll(".ps-sg"), function (node) {
        node.addEventListener("mousedown", function (e) { e.preventDefault(); choose(Number(node.dataset.i)); });
      });
    }
    function hideSuggest() { suggestEl.hidden = true; sgActive = -1; }
    function highlightSuggest() {
      Array.prototype.forEach.call(suggestEl.querySelectorAll(".ps-sg"), function (n, i) { n.classList.toggle("ps-active", i === sgActive); });
    }
    function choose(i) { var t = sgItems[i]; if (!t) return; input.value = t.title; hideSuggest(); run(); }

    // ---- facets ----
    function renderFacets(facets) {
      var filter = buildFilter();
      if (!facets && !filter) { facetsEl.hidden = true; facetsEl.innerHTML = ""; return; }
      var groups = [];
      facetFields.forEach(function (field) {
        var vals = (facets && facets[field]) || [];
        if (!vals.length && !refine[field].size) return;
        var items = vals.map(function (v) {
          var on = refine[field].has(v.value);
          return '<label class="ps-fitem"><input type="checkbox" data-field="' + esc(field) + '" value="' + esc(v.value) + '"' + (on ? " checked" : "") + '><span>' + esc(v.value) + '</span><span class="ps-fc">' + v.count + "</span></label>";
        }).join("");
        groups.push('<div class="ps-fgroup"><h4>' + esc(field) + "</h4>" + items + "</div>");
      });
      if (showPrice) {
        var pit = PRICE_RANGES.map(function (r, i) {
          var on = priceRange && priceRange.gte === r.gte && priceRange.lte === r.lte;
          return '<label class="ps-fitem"><input type="radio" name="ps-price" data-price="' + i + '"' + (on ? " checked" : "") + '><span>' + esc(r.label) + "</span></label>";
        }).join("");
        groups.push('<div class="ps-fgroup"><h4>price</h4>' + pit + "</div>");
      }
      facetsEl.innerHTML = groups.join("") + (filter ? '<button class="ps-clear">Clear filters</button>' : "");
      facetsEl.hidden = false;
      Array.prototype.forEach.call(facetsEl.querySelectorAll('input[type="checkbox"]'), function (node) {
        node.addEventListener("change", function () { var s = refine[node.dataset.field]; node.checked ? s.add(node.value) : s.delete(node.value); run(); });
      });
      Array.prototype.forEach.call(facetsEl.querySelectorAll("input[data-price]"), function (node) {
        node.addEventListener("change", function () { var r = PRICE_RANGES[Number(node.dataset.price)]; priceRange = { gte: r.gte, lte: r.lte }; run(); });
      });
      var clear = facetsEl.querySelector(".ps-clear");
      if (clear) clear.addEventListener("click", function () { facetFields.forEach(function (f) { refine[f].clear(); }); priceRange = null; run(); });
    }

    // ---- pager ----
    function renderPager(total) {
      if (!total || total <= PER) { pagerEl.hidden = true; return; }
      var from = offset + 1, to = Math.min(offset + PER, total);
      pagerEl.innerHTML = '<button class="ps-prev"' + (offset === 0 ? " disabled" : "") + ">← Prev</button>" +
        '<span class="ps-info">' + from + "–" + to + " of " + total + "</span>" +
        '<button class="ps-next"' + (to >= total ? " disabled" : "") + ">Next →</button>";
      pagerEl.hidden = false;
      var prev = pagerEl.querySelector(".ps-prev"), next = pagerEl.querySelector(".ps-next");
      if (prev) prev.addEventListener("click", function () { offset = Math.max(0, offset - PER); doSearch(); });
      if (next) next.addEventListener("click", function () { offset += PER; doSearch(); });
    }

    // ---- hits ----
    function defaultHit(hit) {
      var p = hit.product || {};
      var title = (hit.highlights && hit.highlights.title) || esc(p.title);
      var url = safeUrl(p.url);
      var titleHtml = url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + title + "</a>" : title;
      var img = safeUrl(p.image);
      var thumb = img ? '<img class="ps-thumb" src="' + esc(img) + '" loading="lazy" onerror="this.style.display=\'none\'">' : "";
      var cat = p.category ? '<span class="ps-cat">' + esc(p.category) + "</span>" : "";
      var price = p.price != null ? '<span class="ps-price">' + esc(p.price) + (p.currency ? " " + esc(p.currency) : "") + "</span>" : "";
      return '<div class="ps-hit">' + thumb + '<div class="ps-body"><div class="ps-title">' + titleHtml + '</div><div class="ps-meta">' + cat + price + "</div></div></div>";
    }
    function renderHits(data) {
      var hits = data.results || [];
      if (!hits.length) { hitsEl.innerHTML = ""; emptyEl.textContent = (data.query || buildFilter()) ? "No results." : ""; return; }
      emptyEl.textContent = "";
      hitsEl.innerHTML = hits.map(function (h) { return renderHit ? renderHit(h) : defaultHit(h); }).join("");
    }

    // ---- search ----
    function doSearch() {
      var q = input.value.trim();
      var filter = buildFilter();
      if (!q && !filter) { renderHits({ results: [] }); facetsEl.hidden = true; pagerEl.hidden = true; return; }
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      var url = endpoint + "/api/search?q=" + encodeURIComponent(q) + "&k=" + PER + "&offset=" + offset +
        "&highlight=on&facets=" + encodeURIComponent(facetFields.join(","));
      if (filter) url += "&filter=" + encodeURIComponent(JSON.stringify(filter));
      fetch(url, { signal: ctrl.signal }).then(function (r) { return r.json(); }).then(function (data) {
        renderHits(data); renderFacets(data.facets); renderPager(data.total);
      }).catch(function () {});
    }
    function run() { offset = 0; hideSuggest(); doSearch(); }

    // ---- wire input ----
    input.addEventListener("input", function () { renderSuggest(input.value); clearTimeout(timer); timer = setTimeout(run, 300); });
    input.addEventListener("keydown", function (e) {
      if (suggestEl.hidden || !sgItems.length) { if (e.key === "Enter") { clearTimeout(timer); run(); } return; }
      if (e.key === "ArrowDown") { e.preventDefault(); sgActive = Math.min(sgActive + 1, sgItems.length - 1); highlightSuggest(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sgActive = Math.max(sgActive - 1, -1); highlightSuggest(); }
      else if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); sgActive >= 0 ? choose(sgActive) : run(); }
      else if (e.key === "Escape") hideSuggest();
    });
    input.addEventListener("blur", function () { setTimeout(hideSuggest, 120); });

    if (options.initialQuery) { input.value = options.initialQuery; run(); }
    return { search: function (q) { input.value = q; run(); }, destroy: function () { root.innerHTML = ""; root.classList.remove("ps-root"); } };
  }

  var api = { create: create, version: "0.2.0" };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.PragmaSearch = api;
})();
