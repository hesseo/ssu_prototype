/* SSU:CLEAN 프로토타입
 * 흐름: 홈 → (수거대 지도/리스트 → 층별 수거대) → QR 스캔 → 컵 올리기 → 측정 → 실패/성공 → 홈
 *       하단 탭: 홈 · 수거대 · QR · 혜택 · MY(비활성)
 */
(function () {
  'use strict';

  var MEASURE_MS = 1800;
  var REWARD_POINTS = 100;
  var BASE_COUNT = 12;
  var CLOCK = '19:27';

  // img/sub_map.png(786×1544) 기준 핀 끝점 좌표
  var MAP_W = 786, MAP_H = 1544;
  var PLACES = [
    { id: 'sd', name: '숭덕경상관', dist: '32m', floors: ['1F', '2F', '3F'], pin: { x: 191, y: 452 } },
    { id: 'ai', name: '안익태기념관', dist: '210m', floors: ['1F', '2F'], pin: { x: 205, y: 1372 } },
    { id: 'hn', name: '형남공학관', dist: '260m', floors: ['1F', '3F', '5F'], pin: { x: 752, y: 1362 } }
  ];
  // 지도에 표시만 되는 수거대 핀(시안의 전기차충전소 옆)
  var STATIC_PINS = [{ x: 727, y: 472 }];

  var CHIPS = [
    { id: 'all', label: '전체' },
    { id: 'cafe', label: '교내 카페' },
    { id: 'print', label: '프린트기' },
    { id: 'goods', label: '기념품' },
    { id: 'meal', label: '학생식당' }
  ];
  var REWARDS = [
    { kind: 'cafe', cat: '교내 카페', name: '아메리카노 쿠폰', price: 3000, img: 'img/americano.png' },
    { kind: 'cafe', cat: '교내 카페', name: '카페 라떼 쿠폰', price: 3500, img: 'img/latte.png' },
    { kind: 'print', cat: '교내 프린트기', name: '이용금액 충전', price: 500, img: 'img/printer.png' },
    { kind: 'meal', cat: '교내 학생식당', name: '학생식당 이용권', price: 5000, img: 'img/ticket.png' },
    { kind: 'print', cat: '교내 프린트기', name: '이용금액 충전', price: 1000, img: 'img/printer.png' }
  ];

  var FAIL_STEPS = [
    '근처 화장실 또는 배출구에 잔여물을 비워주세요',
    '다시 QR을 스캔해주세요',
    '수거대 위에 컵을 올려주세요'
  ];

  // 오늘 이전의 배출 기록(누적 배출 12회와 맞춤). 성공할 때마다 state.history 앞에 쌓여요.
  var PAST_HISTORY = [
    { date: '10.04', time: '13:12', place: 'sd', floor: '1층' },
    { date: '10.02', time: '10:41', place: 'hn', floor: '3층' },
    { date: '10.01', time: '15:20', place: 'sd', floor: '2층' },
    { date: '09.29', time: '12:05', place: 'ai', floor: '1층' },
    { date: '09.26', time: '17:48', place: 'sd', floor: '1층' },
    { date: '09.25', time: '11:30', place: 'hn', floor: '1층' },
    { date: '09.23', time: '14:02', place: 'sd', floor: '3층' },
    { date: '09.22', time: '09:55', place: 'ai', floor: '2층' },
    { date: '09.18', time: '16:37', place: 'sd', floor: '1층' },
    { date: '09.16', time: '13:20', place: 'hn', floor: '5층' },
    { date: '09.12', time: '12:44', place: 'sd', floor: '2층' },
    { date: '09.09', time: '10:08', place: 'sd', floor: '1층' }
  ];
  var CUP_GRAMS = 15;          // 컵 1개당 재활용 플라스틱 무게(가정)

  var MY_MENU = [
    { id: 'history', label: '포인트 내역', icon: 'receipt' },
    { id: 'coupons', label: '내 쿠폰함', icon: 'ticket' },
    { id: 'notice', label: '공지사항', icon: 'megaphone' },
    { id: 'help', label: '고객센터', icon: 'headset' },
    { id: 'settings', label: '설정', icon: 'gear' }
  ];

  var opts = { failFirst: true, startPoints: 1250 };

  function initialState() {
    return {
      screen: 'home',      // home | map | qr | cup | measuring | fail | success | voucher | my | history
      prev: 'home',        // QR 화면에서 뒤로가기 대상
      mapMode: 'map',      // map | list
      sheet: null,         // 바텀시트로 열린 장소 id
      place: 'sd',         // 연결된 수거대 건물
      floor: '1층',
      tries: 0,
      earned: 0,
      cnt: 0,
      chip: 'all',
      history: [],         // 이번 세션에서 성공한 배출 기록
      toast: null
    };
  }

  var state = initialState();
  var timer = null;
  var toastTimer = null;
  var app = document.getElementById('app');

  function setState(patch) {
    for (var k in patch) state[k] = patch[k];
    render();
  }

  function go(screen) {
    var patch = { screen: screen, toast: null };
    if (screen === 'qr') patch.prev = state.screen === 'qr' ? state.prev : state.screen;
    if (screen !== 'map') patch.sheet = null;
    setState(patch);
  }

  function fmt(n) { return n.toLocaleString('en-US'); }
  function points() { return opts.startPoints + state.earned; }
  function placeById(id) { return PLACES.filter(function (p) { return p.id === id; })[0]; }

  /* ---------- Icons ---------- */
  var PIN_BLUE = '<img src="img/pin_blue.png" width="28" height="39" alt="">';
  var PIN_RED = '<img src="img/pin_red.png" width="44" height="61" alt="">';

  // 그럴듯한 QR 모양(장식용). 시드 고정이라 매번 같은 모양.
  var QR_SVG = (function () {
    var n = 25, seed = 7, cells = '';
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    function inFinder(x, y) {
      return (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
    }
    function finder(ox, oy) {
      return '<rect x="' + (ox + .5) + '" y="' + (oy + .5) + '" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1"/>' +
        '<rect x="' + (ox + 2) + '" y="' + (oy + 2) + '" width="3" height="3" fill="currentColor"/>';
    }
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (!inFinder(x, y) && rnd() > .52) cells += 'M' + x + ' ' + y + 'h1v1h-1z';
      }
    }
    return '<svg class="qr__code" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" style="color:#ECEFF2">' +
      finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7) +
      '<path d="' + cells + '" fill="currentColor"/></svg>';
  })();

  var ICON = {
    pin: function (size, color, w) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="' + (w || 2.4) + '" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/></svg>';
    },
    pinSolid: '<svg width="13" height="13" viewBox="0 0 24 24"><path d="M12 22s-7.5-6.6-7.5-12.3a7.5 7.5 0 0 1 15 0C19.5 15.4 12 22 12 22z" fill="#2E8BC0"/><circle cx="12" cy="9.7" r="2.8" fill="#fff"/></svg>',
    bin: '<svg width="13" height="13" viewBox="0 0 24 24"><path d="M5 7h14l-1.4 13a1.5 1.5 0 0 1-1.5 1.3H7.9a1.5 1.5 0 0 1-1.5-1.3z" fill="#2E8BC0"/><rect x="3.5" y="4" width="17" height="3" rx="1" fill="#2E8BC0"/></svg>',
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#17212B" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: function (size, color, w) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    },
    checkGradient: '<svg width="54" height="54" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="ckg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2E7FD0"/><stop offset="1" stop-color="#3CC3C8"/></linearGradient></defs><path d="M5 12.5l4.5 4.5L19 7.5" stroke="url(#ckg)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cup: function (size, color, w) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14M6.5 8l1.4 12.2a1 1 0 0 0 1 .8h6.2a1 1 0 0 0 1-.8L17.5 8M7.5 8a4.5 4.5 0 0 1 9 0M12 3.5l2.5-1.5"/></svg>';
    },
    qrNav: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM18 18h3v3h-3z"/></svg>',
    home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 10.6L12 3.8l8.5 6.8V20a1.2 1.2 0 0 1-1.2 1.2h-4.6v-6.2H9.3v6.2H4.7A1.2 1.2 0 0 1 3.5 20z"/></svg>',
    mapNav: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22s-7.5-6.6-7.5-12.3a7.5 7.5 0 0 1 15 0C19.5 15.4 12 22 12 22z"/><circle cx="12" cy="9.7" r="2.8" fill="#fff"/></svg>',
    gift: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="7.5" width="18" height="5" rx="1.2"/><path d="M4.5 13.5h6.7v8H5.7a1.2 1.2 0 0 1-1.2-1.2zM12.8 13.5h6.7v6.8a1.2 1.2 0 0 1-1.2 1.2h-5.5z"/><path d="M12 7.5C10.5 4 6.5 4 6.5 6s3.5 1.5 5.5 1.5zM12 7.5c1.5-3.5 5.5-3.5 5.5-1.5S14 7.5 12 7.5z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    user: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7.8" r="4.3"/><path d="M3.8 20.8c.9-4.6 4.2-7 8.2-7s7.3 2.4 8.2 7z"/></svg>',
    receipt: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
    ticket: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v1h18v-1a2 2 0 0 1 0-4 2 2 0 0 0 0-4V7H3z"/><path d="M14 7v10" stroke-dasharray="2 2"/></svg>',
    megaphone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h3l7 4V6L7 10z"/><path d="M17.5 9.5a3.5 3.5 0 0 1 0 5"/></svg>',
    headset: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/></svg>',
    gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
    backDark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#17212B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    signal: '<svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>',
    wifi: '<svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.7 10.7 0 0 0 8 .4C5.2.4 2.5 1.5.5 3.4l1.2 1.3A9 9 0 0 1 8 2.2z"/><path d="M8 5.6c1.5 0 2.9.6 4 1.5l1.2-1.3A7.6 7.6 0 0 0 8 3.8a7.6 7.6 0 0 0-5.2 2l1.2 1.3c1.1-.9 2.5-1.5 4-1.5z"/><path d="M8 9.1c.7 0 1.3.2 1.8.6L8 11.6 6.2 9.7c.5-.4 1.1-.6 1.8-.6z"/></svg>',
    battery: '<svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x=".5" y=".5" width="23" height="12" rx="3.5" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2.2" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="currentColor" opacity=".45"/></svg>'
  };

  /* ---------- Screens ---------- */
  function homeScreen() {
    return '' +
      '<div class="screen screen--tabbed scroll home">' +
        '<div class="home__hero">' +
          '<img src="img/쓰통_bg.png" alt="">' +
          '<div class="home__greet">' +
            '<div class="home__hi">안녕하세요 👋</div>' +
            '<div class="home__headline">오늘도 SSU:CLEAN과<br>함께해요.</div>' +
          '</div>' +
        '</div>' +
        '<div class="card home__stats">' +
          '<div class="stat"><div class="stat__label">내 Clean Point</div><div class="stat__value points">' + fmt(points()) + ' P</div></div>' +
          '<div class="stat"><div class="stat__label">누적 배출</div><div class="stat__value points">' + (BASE_COUNT + state.cnt) + '회</div></div>' +
        '</div>' +
        '<div class="home__cta">' +
          '<div class="home__cta-top">' +
            '<div><div class="home__cta-sub">플라스틱 컵 배출로 포인트를 받아요</div><div class="home__cta-title">테이크아웃 컵이 있으신가요?</div></div>' +
            '<img src="img/coffee_icon.png" alt="">' +
          '</div>' +
          '<button type="button" data-action="go" data-to="qr">컵 인증하기</button>' +
        '</div>' +
        '<div class="section-head">' +
          '<div class="section-head__title">' + ICON.pin(16, '#E5484D') + '주변 SSU:CLEAN 찾기</div>' +
          '<button type="button" class="link-btn" data-action="go" data-to="map">전체보기 ›</button>' +
        '</div>' +
        '<button type="button" class="map-preview" data-action="go" data-to="map" aria-label="지도에서 수거대 보기">' +
          '<img src="img/main_map.png" alt="">' +
        '</button>' +
      '</div>';
  }

  function pos(pt) {
    return 'left:' + (pt.x / MAP_W * 100) + '%;top:' + (pt.y / MAP_H * 100) + '%';
  }

  function mapScreen() {
    var body;
    if (state.mapMode === 'map') {
      body = '<div class="map__canvas"><img src="img/sub_map.png" alt="캠퍼스 지도">' +
        STATIC_PINS.map(function (pt) {
          return '<span class="map__pin map__pin--static" style="' + pos(pt) + '">' + PIN_BLUE + '</span>';
        }).join('') +
        PLACES.map(function (p) {
          var on = state.sheet === p.id;
          return '<button type="button" class="map__pin' + (on ? ' map__pin--selected' : '') + '" data-action="open-sheet" data-id="' + p.id + '" aria-label="' + p.name + ' 수거대" aria-pressed="' + on + '" style="' + pos(p.pin) + '">' +
            (on ? PIN_RED : PIN_BLUE) +
          '</button>';
        }).join('') +
        '</div>';
    } else {
      body = '<div class="map__list">' +
        PLACES.map(function (p) {
          return '<button type="button" class="place" data-action="open-sheet" data-id="' + p.id + '">' +
            '<img src="assets/station.jpg" alt="">' +
            '<div class="place__body"><div class="place__name">' + p.name + '</div>' +
            '<div class="meta">' + ICON.pinSolid + p.dist + '<span style="margin:0 4px;color:#C5CCD3">|</span>' + ICON.bin + '컵 수거대 ' + p.floors.length + '곳</div></div>' +
            '<div class="place__chev">›</div>' +
          '</button>';
        }).join('') +
        '</div>';
    }
    return '' +
      '<div class="screen screen--tabbed map">' + body +
        '<div class="segmented" role="group" aria-label="보기 방식">' +
          '<button type="button" data-action="map-mode" data-mode="map" aria-pressed="' + (state.mapMode === 'map') + '">지도</button>' +
          '<button type="button" data-action="map-mode" data-mode="list" aria-pressed="' + (state.mapMode === 'list') + '">리스트</button>' +
        '</div>' +
      '</div>';
  }

  function sheet() {
    var p = placeById(state.sheet);
    if (!p) return '';
    return '' +
      '<div class="sheet" role="dialog" aria-label="' + p.name + ' 수거대">' +
        '<div class="sheet__grip"></div>' +
        '<button type="button" class="icon-btn sheet__close" data-action="close-sheet" aria-label="닫기">' + ICON.close + '</button>' +
        '<div class="sheet__head">' +
          '<img src="assets/station.jpg" alt="' + p.name + ' 수거대 사진">' +
          '<div class="sheet__info">' +
            '<div class="sheet__name">' + p.name + '</div>' +
            '<div class="meta">' + ICON.pinSolid + p.dist + '</div>' +
            '<div class="meta">' + ICON.bin + '컵 수거대 ' + p.floors.length + '곳</div>' +
          '</div>' +
        '</div>' +
        '<div class="sheet__sub">층별 수거대 위치</div>' +
        '<div class="sheet__floors">' +
          p.floors.map(function (f) {
            return '<div class="floor"><img src="assets/station.jpg" alt="">' +
              '<div class="floor__label">' + f + ' 화장실 옆</div>' +
              '<button type="button" class="pill-btn" data-action="floor-qr" data-id="' + p.id + '" data-floor="' + f + '">QR 인증하기</button></div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  function qrScreen() {
    return '' +
      '<div class="screen qr">' +
        '<button type="button" class="back-btn" data-action="back" aria-label="뒤로가기">' + ICON.back + '</button>' +
        '<div><div class="qr__title">수거대에 도착하셨나요?</div>' +
        '<div class="qr__desc">컵 속 잔여물을 비운 뒤,<br>수거대의 QR을 스캔해주세요.</div></div>' +
        '<div class="qr__frame">' +
          '<div class="qr__corner qr__corner--tl"></div><div class="qr__corner qr__corner--tr"></div>' +
          '<div class="qr__corner qr__corner--bl"></div><div class="qr__corner qr__corner--br"></div>' +
          '<div class="qr__scanline"></div>' +
          QR_SVG +
          '<div class="qr__hint">QR을 프레임 안에 맞춰주세요</div>' +
        '</div>' +
        '<div class="qr__tip"><div class="qr__tip-title">Tip!</div>' +
          '<div class="qr__tip-body">잠깐! 컵은 비우셨나요? 💧<br>남은 음료와 이물질을 비운 컵만 수거대에 올려주세요</div></div>' +
        '<div class="spacer"></div>' +
        '<button type="button" class="shutter" data-action="scan" aria-label="QR 스캔하기"></button>' +
      '</div>';
  }

  function cupScreen() {
    var p = placeById(state.place);
    var measuring = state.screen === 'measuring';
    return '' +
      '<div class="screen cup">' +
        '<div class="card connected">' +
          '<div class="check-dot">' + ICON.check(18, '#fff', 3) + '</div>' +
          '<div><div class="connected__title">' + p.name + ' ' + state.floor + ' 수거대에 연결됐어요</div>' +
          '<div class="connected__sub">QR 인증 완료</div></div>' +
        '</div>' +
        '<button type="button" class="cup__target' + (measuring ? ' is-measuring' : '') + '" data-action="place-cup" aria-label="컵 올리기 (탭하면 측정 시작)">' +
          '<div class="ring"><div class="ring__dash">' + ICON.cup(64, '#2E7FB0', 1.6) + '</div>' +
            (measuring ? '<div class="measuring-ring"></div><div class="measuring-label" role="status">측정 중...</div>' : '') +
          '</div>' +
          '<div class="cup__title">컵을 수거대 위에 올려주세요</div>' +
          '<div class="cup__desc">올리면 무게를 자동으로 측정해요<br>빈 컵으로 확인되면 바로 포인트가 적립돼요</div>' +
          '<div class="badge">기준 20g 이하</div>' +
        '</button>' +
        '<div class="proto-note">프로토타입: 카드를 탭하면 컵을 올린 것으로 처리돼요</div>' +
        (measuring ? '<div class="dim"></div>' : '') +
      '</div>';
  }

  function failScreen() {
    return '' +
      '<div class="screen fail">' +
        '<div class="card fail__card">' +
          '<div class="ring ring--danger"><div class="ring__dash">' + ICON.cup(54, '#fff', 1.7) + '</div></div>' +
          '<div class="fail__title">컵에 아직 음료가 남아 있어요</div>' +
          '<div class="fail__sub">기준 무게를 초과했어요</div>' +
          '<div class="weight"><div class="weight__label">측정 무게</div>' +
            '<div><span class="weight__over">30g</span><span class="weight__limit"> / 기준 20g</span></div></div>' +
          '<div class="weight-bar"><div class="weight-bar__ok" style="width:67%"></div><div class="weight-bar__over" style="width:33%"></div></div>' +
        '</div>' +
        '<div class="card steps">' +
          '<div class="steps__title">이렇게 하면 바로 통과돼요</div>' +
          FAIL_STEPS.map(function (t, i) {
            return '<div class="step"><div class="step__n">' + (i + 1) + '</div><div>' + t + '</div></div>';
          }).join('') +
        '</div>' +
        '<div class="spacer"></div>' +
        '<button type="button" class="btn-primary" data-action="retry">확인</button>' +
      '</div>';
  }

  function successScreen() {
    return '' +
      '<div class="screen success">' +
        '<div class="success__badge"><div class="success__badge-inner">' + ICON.checkGradient + '</div></div>' +
        '<div class="success__title">컵 배출 완료!</div>' +
        '<div class="success__sub">올바르게 배출해 주셔서 감사해요</div>' +
        '<div class="earned">' +
          '<div class="earned__label">이번 배출로 받은 포인트</div>' +
          '<div class="earned__value">+ ' + REWARD_POINTS + ' <small>P</small></div>' +
          '<img src="img/coin.png" alt="">' +
        '</div>' +
        '<div class="total"><div class="total__label">누적된 포인트</div><div class="total__value points">' + fmt(points()) + ' P</div></div>' +
        '<div class="success__note">포인트는 교내 카페 할인 / 프린트 / 기념품으로<br>교환할 수 있어요! 🎁</div>' +
        '<div class="spacer"></div>' +
        '<button type="button" class="btn-primary" data-action="go" data-to="home">홈으로 가기</button>' +
      '</div>';
  }

  function voucherScreen() {
    var list = REWARDS.filter(function (r) { return state.chip === 'all' || r.kind === state.chip; });
    return '' +
      '<div class="screen screen--tabbed scroll voucher">' +
        '<div class="voucher__title">바우처 혜택</div>' +
        '<div class="voucher__desc">모은 포인트로<br>다양한 혜택을 받아보세요 🌱</div>' +
        '<div class="card voucher__balance">' +
          '<div><div class="voucher__balance-label">내 Clean Point</div><div class="voucher__balance-value points">' + fmt(points()) + ' P</div></div>' +
          '<img src="img/coin.png" alt="">' +
        '</div>' +
        '<div class="chips" role="group" aria-label="혜택 분류">' +
          CHIPS.map(function (c) {
            return '<button type="button" class="chip" data-action="chip" data-id="' + c.id + '" aria-pressed="' + (state.chip === c.id) + '">' + c.label + '</button>';
          }).join('') +
        '</div>' +
        (list.length
          ? '<div class="rewards">' + list.map(function (r) {
              return '<div class="reward">' +
                '<div class="reward__thumb reward__thumb--' + r.kind + '"><img src="' + r.img + '" alt="' + r.name + '"></div>' +
                '<div class="reward__cat">' + r.cat + '</div>' +
                '<div class="reward__name">' + r.name + '</div>' +
                '<div class="reward__price"><div class="reward__coin"></div>' + fmt(r.price) + ' P</div>' +
              '</div>';
            }).join('') + '</div>'
          : '<div class="empty">기념품은 곧 준비될 예정이에요</div>') +
      '</div>';
  }

  /* ---------- MY ---------- */
  function allHistory() {
    return state.history.concat(PAST_HISTORY);
  }

  function historyRow(h) {
    var p = placeById(h.place);
    return '<div class="record">' +
      '<div class="record__icon">' + ICON.cup(18, '#2E8BC0', 2) + '</div>' +
      '<div class="record__body"><div class="record__title">' + p.name + ' ' + h.floor + ' 수거대</div>' +
      '<div class="record__meta">' + h.date + ' ' + h.time + ' · 컵 배출</div></div>' +
      '<div class="record__pts">+' + REWARD_POINTS + ' P</div>' +
    '</div>';
  }

  function myScreen() {
    var count = BASE_COUNT + state.cnt;
    var recent = allHistory().slice(0, 3);
    return '' +
      '<div class="screen screen--tabbed scroll my">' +
        '<div class="my__title">마이페이지</div>' +
        '<div class="card profile">' +
          '<div class="profile__top">' +
            '<div class="avatar" aria-hidden="true">🌱</div>' +
            '<div class="profile__info">' +
              '<div class="profile__name">숭실이 님</div>' +
              '<div class="profile__sub">SSU:CLEAN과 함께한 지 32일째</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card my__stats">' +
          '<div class="stat"><div class="stat__label">Clean Point</div><div class="stat__value points">' + fmt(points()) + '</div></div>' +
          '<div class="stat"><div class="stat__label">누적 배출</div><div class="stat__value points">' + count + '회</div></div>' +
          '<div class="stat"><div class="stat__label">재활용 플라스틱</div><div class="stat__value points">' + fmt(count * CUP_GRAMS) + 'g</div></div>' +
        '</div>' +
        '<div class="card my__section">' +
          '<div class="my__section-head"><div class="my__section-title">최근 배출 기록</div>' +
            '<button type="button" class="link-btn" data-action="go" data-to="history">전체보기 ›</button></div>' +
          recent.map(historyRow).join('') +
        '</div>' +
        '<div class="card menu">' +
          MY_MENU.map(function (m) {
            var attrs = m.id === 'history' ? 'data-action="go" data-to="history"' : 'data-action="soon"';
            return '<button type="button" class="menu__item" ' + attrs + '>' +
              '<span class="menu__icon">' + ICON[m.icon] + '</span>' + m.label + '<span class="menu__chev">›</span></button>';
          }).join('') +
        '</div>' +
        '<div class="my__foot">버전 0.1.0 (프로토타입)</div>' +
      '</div>';
  }

  function historyScreen() {
    var list = allHistory();
    var thisMonth = list.filter(function (h) { return h.date === '오늘' || h.date.indexOf('10.') === 0; }).length;
    var signup = opts.startPoints - PAST_HISTORY.length * REWARD_POINTS;
    return '' +
      '<div class="screen scroll history">' +
        '<div class="history__bar">' +
          '<button type="button" class="back-btn back-btn--light" data-action="go" data-to="my" aria-label="뒤로가기">' + ICON.backDark + '</button>' +
          '<div class="history__title">포인트 내역</div>' +
        '</div>' +
        '<div class="card history__summary">' +
          '<div><div class="stat__label">보유 포인트</div><div class="history__total points">' + fmt(points()) + ' P</div></div>' +
          '<div class="history__month"><div class="stat__label">이번 달 적립</div><div class="history__month-value">+' + fmt(thisMonth * REWARD_POINTS) + ' P</div></div>' +
        '</div>' +
        '<div class="card my__section">' +
          list.map(historyRow).join('') +
          (signup > 0
            ? '<div class="record"><div class="record__icon record__icon--gift">🎉</div>' +
                '<div class="record__body"><div class="record__title">가입 축하 포인트</div><div class="record__meta">09.01 · 이벤트</div></div>' +
                '<div class="record__pts">+' + fmt(signup) + ' P</div></div>'
            : '') +
        '</div>' +
      '</div>';
  }

  function nav() {
    var tab = state.screen === 'map' || state.screen === 'voucher' || state.screen === 'my' ? state.screen : 'home';
    function cur(t) { return tab === t ? ' aria-current="page"' : ''; }
    return '' +
      '<nav class="nav" aria-label="하단 메뉴">' +
        '<button type="button" class="nav__item" data-action="go" data-to="home"' + cur('home') + '>' + ICON.home + '홈</button>' +
        '<button type="button" class="nav__item" data-action="go" data-to="map"' + cur('map') + '>' + ICON.mapNav + '수거대</button>' +
        '<div class="nav__center"><button type="button" class="nav__qr" data-action="go" data-to="qr" aria-label="QR 인증">' + ICON.qrNav + '</button></div>' +
        '<button type="button" class="nav__item" data-action="go" data-to="voucher"' + cur('voucher') + '>' + ICON.gift + '혜택</button>' +
        '<button type="button" class="nav__item" data-action="go" data-to="my"' + cur('my') + '>' + ICON.user + 'MY</button>' +
      '</nav>';
  }

  function chrome(s) {
    var lightBar = s === 'home' || s === 'qr' || s === 'measuring' || s === 'success';
    var lightIndicator = s === 'qr' || s === 'measuring';
    // 스크롤되는 밝은 화면은 상태바에 배경을 깔아 내용이 시계 밑으로 겹치지 않게
    var barBg = s === 'my' || s === 'history' ? ' statusbar--soft' : s === 'voucher' ? ' statusbar--mint' : '';
    return '' +
      '<div class="statusbar' + (lightBar ? ' statusbar--light' : '') + barBg + '" aria-hidden="true">' +
        '<span>' + CLOCK + '</span>' +
        '<span class="statusbar__icons">' + ICON.signal + ICON.wifi + ICON.battery + '</span>' +
      '</div>' +
      '<div class="home-indicator' + (lightIndicator ? ' home-indicator--light' : '') + '" aria-hidden="true"></div>' +
      (state.toast ? '<div class="toast" role="status">' + state.toast + '</div>' : '');
  }

  /* ---------- Render ---------- */
  var lastScreen = null;

  function render() {
    var s = state.screen;
    var scroller = app.querySelector('.scroll');
    var keepScroll = s === lastScreen && scroller ? scroller.scrollTop : 0;

    var html;
    if (s === 'home') html = homeScreen();
    else if (s === 'map') html = mapScreen();
    else if (s === 'qr') html = qrScreen();
    else if (s === 'cup' || s === 'measuring') html = cupScreen();
    else if (s === 'fail') html = failScreen();
    else if (s === 'success') html = successScreen();
    else if (s === 'my') html = myScreen();
    else if (s === 'history') html = historyScreen();
    else html = voucherScreen();

    if (s === 'home' || s === 'map' || s === 'voucher' || s === 'my') html += nav();
    if (s === 'map' && state.sheet) html += sheet();
    html += chrome(s);

    app.innerHTML = html;

    var next = app.querySelector('.scroll');
    if (next) next.scrollTop = keepScroll;
    lastScreen = s;
  }

  /* ---------- Actions ---------- */
  var actions = {
    go: function (el) { go(el.dataset.to); },
    back: function () { setState({ screen: state.prev || 'home' }); },
    'map-mode': function (el) { setState({ mapMode: el.dataset.mode, sheet: null }); },
    'open-sheet': function (el) { setState({ screen: 'map', sheet: el.dataset.id }); },
    'close-sheet': function () { setState({ sheet: null }); },
    'floor-qr': function (el) {
      setState({ place: el.dataset.id, floor: el.dataset.floor.replace('F', '층'), screen: 'qr', prev: 'map', sheet: null });
    },
    scan: function () { setState({ screen: 'cup' }); },
    'place-cup': function () {
      if (state.screen !== 'cup') return;
      setState({ screen: 'measuring' });
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (opts.failFirst && state.tries === 0) {
          setState({ screen: 'fail', tries: state.tries + 1 });
        } else {
          var rec = { date: '오늘', time: CLOCK, place: state.place, floor: state.floor };
          setState({ screen: 'success', tries: 0, earned: state.earned + REWARD_POINTS, cnt: state.cnt + 1, history: [rec].concat(state.history) });
        }
      }, MEASURE_MS);
    },
    retry: function () { setState({ screen: 'qr', prev: 'home' }); },
    chip: function (el) { setState({ chip: el.dataset.id }); },
    soon: function () {
      clearTimeout(toastTimer);
      setState({ toast: '프로토타입에서는 준비 중인 기능이에요' });
      toastTimer = setTimeout(function () { setState({ toast: null }); }, 1600);
    }
  };

  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || !app.contains(el)) return;
    var fn = actions[el.dataset.action];
    if (fn) fn(el);
  });

  /* ---------- Prototype controls ---------- */
  var failInput = document.getElementById('opt-fail-first');
  var pointsInput = document.getElementById('opt-start-points');

  failInput.addEventListener('change', function () { opts.failFirst = failInput.checked; });
  pointsInput.addEventListener('input', function () {
    var v = parseInt(pointsInput.value, 10);
    opts.startPoints = isNaN(v) ? 0 : Math.max(0, v);
    render();
  });
  document.getElementById('opt-reset').addEventListener('click', function () {
    clearTimeout(timer);
    clearTimeout(toastTimer);
    state = initialState();
    render();
  });

  render();
})();
