// Token Radar v7 — dashboard logic. No network: all data is window.RADAR from data.js.
(function () {
  var R = window.RADAR;
  var watch = new Set(R.watchlist || []);
  var sel = R.selection;
  var counts = R.counts;

  function $(id) { return document.getElementById(id); }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n) { return (n * 100).toFixed(1) + '%'; }
  function fmtChange(v) {
    if (v === null || v === undefined) return '<span class="num">—</span>';
    var cls = v >= 0 ? 'up' : 'down';
    return '<span class="num ' + cls + '">' + (v >= 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 365) return Math.round(days) + 'd';
    return (days / 365.25).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- header counts: every protocol accounted for, 758 = board + live + tracked
  $('counts').innerHTML =
    stat(counts.board, 'ranked') + stat(counts.watchlist, 'watchlist') +
    stat(counts.live, 'live tokens') + stat(counts.tracked, 'tracked') +
    stat(counts.total, 'total');
  function stat(n, label) {
    return '<div class="stat"><b>' + n + '</b><span>' + label + '</span></div>';
  }
  $('asof').textContent = R.as_of;

  // ---- method: the winning set and the blind-test table
  var coef = sel.coefficients;
  $('method-text').innerHTML =
    'Rank is <b>pure implied value</b>: log market cap fit by least squares on the ' + sel.fit_size +
    ' live protocols that record a market cap, from log TVL and the 7-day change clipped to [-1, 3]. ' +
    'Fitted: log mcap = ' + coef[0].toFixed(3) + ' + ' + coef[1].toFixed(3) + ' x log(TVL) ' +
    (coef[2] >= 0 ? '+ ' : '- ') + Math.abs(coef[2]).toFixed(3) + ' x clipped change. ' +
    'Feature set <b>' + sel.winner + '</b> won the two blind tests below; token odds never touch the rank.';
  var tb = document.querySelector('#select-table tbody');
  sel.rows.forEach(function (r) {
    var tr = document.createElement('tr');
    if (r.set === sel.winner) tr.className = 'winner';
    tr.innerHTML = '<td><b>' + r.set + '</b> — ' + esc(r.features) + '</td>' +
      '<td class="num">' + r.loo_factor.toFixed(3) + 'x</td>' +
      '<td class="num">' + r.walk_forward_2025_01_06.toFixed(3) + 'x</td>' +
      '<td class="num">' + r.walk_forward_2025_06_01.toFixed(3) + 'x</td>' +
      '<td class="num">' + r.worst_walk_forward.toFixed(3) + 'x</td>' +
      '<td>' + (r.set === sel.winner ? '<span class="won">WINNER</span>' : '') + '</td>';
    tb.appendChild(tr);
  });
  $('method-fine').textContent =
    'Errors are median multiplicative factors, exp(median |predicted log mcap - actual log mcap|). ' +
    'Pre-token means the snapshot records no token: both gecko_id and symbol are null. A protocol that carries a symbol already records a token and is shown in the Live view, never ranked. ' +
    'Set B ties A on worst-case walk-forward (its capped-age column is constant in both walk-forward train sets, so it predicts as A does) and loses the leave-one-out tie-break, 3.553x vs 3.509x. ' +
    'Set C loses outright: uncapped age is a cohort effect, not a predictor. ' +
    'Farm verdicts: 5% of implied value as the airdrop pool, farmer count from TVL at a $2,000 typical deposit, gas on the cheapest chain for 12 transactions, 4 active hours. ' +
    'FARM at $10/hour or more, THIN at $2/hour or more, else SKIP.';

  // ---- state
  var tab = 'board';
  var sortKey = 'rank';
  var sortDir = 1;
  var selected = null;

  function boardRows() {
    var q = $('q').value.trim().toLowerCase();
    var verdict = $('verdict').value;
    var onlyWatch = $('watch').checked;
    var rows = R.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      if (verdict && r.verdict !== verdict) return false;
      if (onlyWatch && !watch.has(r.slug)) return false;
      return true;
    });
    var key = sortKey;
    rows.sort(function (a, b) {
      var d = 0;
      if (key === 'rank') d = a.rank - b.rank;
      else if (key === 'tvl') d = b.tvl_usd - a.tvl_usd;
      else if (key === 'implied') d = b.implied_value_usd - a.implied_value_usd;
      else if (key === 'hour') d = b.usd_per_hour - a.usd_per_hour;
      else if (key === 'age') d = (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days);
      else if (key === 'name') d = a.name < b.name ? -1 : 1;
      else if (key === 'chg') d = (b.change_7d === null ? -999 : b.change_7d) - (a.change_7d === null ? -999 : a.change_7d);
      else if (key === 'odds') d = b.token_odds - a.token_odds;
      else if (key === 'verdict') d = a.verdict < b.verdict ? -1 : 1;
      return d * sortDir;
    });
    return rows;
  }

  function shortChains(chains, max) {
    if (chains.length <= max) return esc(chains.join(', '));
    return esc(chains.slice(0, max).join(', ')) + ' +' + (chains.length - max) + ' more';
  }

  function rowHtml(r) {
    var w = watch.has(r.slug) ? ' <span class="watch">WATCHLIST</span>' : '';
    return '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="selected"' : '') + '>' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + '</span>' + w +
      '<span class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' + shortChains(r.chains, 3) + '</span></td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td>' + fmtChange(r.change_7d) + '</td>' +
      '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
      '<td class="num">' + (r.usd_per_hour >= 0 ? '$' : '-$') + Math.abs(r.usd_per_hour).toFixed(2) + '</td>' +
      '<td><span class="pill ' + r.verdict + '">' + r.verdict + '</span></td>' +
      '<td class="num">' + pct(r.token_odds) + '</td>' +
      '<td class="num">' + fmtAge(r.age_days) + '</td></tr>';
  }

  function liveHtml(r) {
    return '<tr data-slug="' + esc(r.slug) + '"><td class="num">—</td>' +
      '<td><span class="name">' + esc(r.name) + '</span>' +
      '<span class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' + shortChains(r.chains, 3) + '</span></td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td>' + fmtChange(r.change_7d) + '</td>' +
      '<td class="num"><b>' + (r.mcap_usd === null ? 'no mcap recorded' : money(r.mcap_usd)) + '</b></td>' +
      '<td class="num">—</td><td><span class="pill SKIP">LIVE</span></td>' +
      '<td class="num">has token</td><td class="num">' + fmtAge(r.age_days) + '</td></tr>';
  }

  function trackedHtml(r) {
    return '<tr><td class="num">—</td>' +
      '<td><span class="name">' + esc(r.name) + '</span>' +
      '<span class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' + shortChains(r.chains, 3) + '</span></td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td>' + fmtChange(r.change_7d) + '</td>' +
      '<td class="num">not ranked</td><td class="num">—</td><td><span class="pill SKIP">TRACKED</span></td>' +
      '<td class="num">—</td><td class="num">' + fmtAge(r.age_days) + '</td></tr>';
  }

  function render() {
    var body = document.querySelector('#board tbody');
    var shown = $('shown');
    var empty = $('empty');
    $('controls').style.display = tab === 'board' ? '' : 'none';
    if (tab === 'board') {
      var rows = boardRows();
      body.innerHTML = rows.map(rowHtml).join('');
      shown.textContent = rows.length + ' of ' + R.rows.length + ' ranked';
      empty.hidden = rows.length > 0;
    } else if (tab === 'live') {
      var q = '';
      body.innerHTML = R.live.map(liveHtml).join('');
      shown.textContent = R.live.length + ' protocols that already record a token — by CoinGecko id or by symbol (market cap shown where recorded, never modelled)';
      empty.hidden = true;
    } else {
      body.innerHTML = R.tracked.map(trackedHtml).join('');
      shown.textContent = R.tracked.length + ' pre-token protocols tracked but not ranked';
      empty.hidden = true;
    }
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
  }

  function showDetail(slug, scroll) {
    var r = null;
    R.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var box = $('detail');
    if (!r) { box.hidden = true; selected = null; render(); return; }
    selected = slug;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    box.innerHTML = '<button class="close" id="close-detail">Close</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<div class="meta"><span>Implied value <b>' + money(r.implied_value_usd) + '</b></span>' +
      '<span>TVL <b>' + money(r.tvl_usd) + '</b></span>' +
      '<span>7d <b>' + (r.change_7d === null ? 'not reported' : r.change_7d.toFixed(1) + '%') + '</b></span>' +
      '<span>Chains <b>' + shortChains(r.chains, 8) + '</b></span>' +
      '<span>Listed <b>' + esc(r.listed_at || 'unknown') + '</b> (' + fmtAge(r.age_days) + ')</span></div>' +
      '<div class="meta"><span>Farm verdict <b><span class="pill ' + r.verdict + '">' + r.verdict + '</span></b></span>' +
      '<span>Net <b>$' + r.usd_per_hour.toFixed(2) + '/hour</b> on a $2,000 standard position</span>' +
      '<span>Expected share <b>' + money(r.expected_share_usd) + '</b></span>' +
      '<span>Break-even <b>' + money(r.break_even_usd) + '</b></span>' +
      '<span>Minimum capital <b>' + money(r.min_capital_usd) + '</b></span></div>' +
      '<p class="fine">Peers with a token (' + esc(r.token_odds_band) + ' band): <b>' + pct(r.token_odds) + '</b> — the share of same-age protocols that already record a token. Information only; it does not change this rank. ' +
      'Model: log mcap predicted ' + r.model.predicted_log_mcap.toFixed(2) + ' from log TVL ' + r.model.log_tvl.toFixed(2) + ' and clipped change ' + r.model.change_clipped + '.</p>' +
      '<h3>How to farm it — 6 steps</h3><ol>' + steps + '</ol>';
    box.hidden = false;
    $('close-detail').onclick = function () { showDetail(null); };
    render();
    if (scroll) window.scrollTo(0, box.getBoundingClientRect().top + window.scrollY);
  }

  // ---- events
  document.querySelector('#board tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'), true);
  });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      if (k === 'rank' || k === 'tvl' || k === 'implied' || k === 'hour' || k === 'age') sortDir = 1;
      render();
    });
  });
  ['q', 'verdict', 'watch', 'sort'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      if (id === 'sort') {
        var v = $('sort').value;
        sortKey = v === 'rank' ? 'rank' : v === 'tvl' ? 'tvl' : v === 'hour' ? 'hour' : v === 'age' ? 'age' : 'name';
        sortDir = 1;
      }
      render();
    });
  });
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      tab = b.getAttribute('data-tab');
      selected = null;
      $('detail').hidden = true;
      render();
    });
  });

  // ---- deep links for screenshots: #detail=<slug>, #filter=FARM|THIN|SKIP, #tab=live|tracked
  var hash = (location.hash || '').replace(/^#/, '');
  var params = {};
  hash.split('&').forEach(function (part) {
    var kv = part.split('=');
    if (kv[0]) params[kv[0]] = decodeURIComponent(kv[1] || '');
  });
  if (params.tab && (params.tab === 'live' || params.tab === 'tracked')) tab = params.tab;
  if (params.filter) { $('verdict').value = params.filter; }
  render();
  if (params.detail) {
    // Scroll after load: a scroll during parse is undone by the browser's
    // own fragment handling when the page finishes loading.
    var openDetail = function () { showDetail(params.detail, false); };
    if (document.readyState === 'complete') openDetail();
    else window.addEventListener('load', openDetail);
  }
})();
