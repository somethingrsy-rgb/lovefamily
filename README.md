# 우리집 가족 대시보드

거실 iPad(가로)와 어른 휴대폰에서 쓰는 한국어 홈 화면 설치형 웹앱(PWA)입니다.
루틴 체크 → 어른 도장 승인(첫 승인 1건만 확정) → 30개 도장 보상 5,000원 → 돼지 저금통 장부, 사고 싶은 것/저축 미션, 엄마·아빠 상태, 공용 사진 알림장, 개인 메시지, 실시간 팝업과 휴대폰 푸시까지 구현했습니다.

## 구성 (선택 사항)
- 서버: Node 22+ (내장 `node:sqlite`) 단일 프로세스, 의존성은 `web-push` 하나. DB와 사진은 `DATA_DIR`(기본 `./data`)에 저장 — 가족 전용 비공개, 사진은 로그인·권한 확인 후에만 전송.
- 화면: 빌드 단계 없는 바닐라 JS PWA(`public/`). 실시간은 SSE(내용 없는 변경 신호 + 권한 검증 API 재조회).
- 인증: 어른 각자 계정(아이디/비밀번호), 가족 코드·초대 링크로 연결. 거실 기기는 "공용 기기 모드"로 로그인하고, 승인·잔액 정정 등 어른 동작은 어른 선택+비밀번호 재인증(10분). 아이별 4자리 비밀번호(선택)로 서로의 저금통·메시지 보호.
- 금액은 원 단위 정수, 날짜는 한국시간(KST). 장부는 `idem_key` 유니크 + 트랜잭션으로 중복 적립/차감 방지.

## Windows PC에서 바로 실행하기
1. **Node.js 22.13 이상(LTS)** 을 https://nodejs.org 에서 설치합니다. (명령 프롬프트에서 `node -v` 로 확인)
2. ZIP을 원하는 폴더에 풀고 **`start-windows.bat`** 을 더블클릭합니다. 처음 한 번은 패키지 설치와 샘플 데이터 생성이 자동으로 진행됩니다.
3. 브라우저에서 **http://localhost:3000** 을 엽니다.
4. 샘플 로그인: `mom@sample.test` / `dad@sample.test` / `grandma@sample.test`, 비밀번호 `sample1234` (개발용 가짜 계정). 새 가족을 만들려면 `data` 폴더를 지우고 다시 실행하세요.
- 수동 실행: 명령 프롬프트(또는 PowerShell)에서 `npm install` → `npm run seed` → `npm start`.
- 같은 Wi-Fi의 iPad·휴대폰에서 열려면 PC의 IP(`ipconfig`)로 `http://PC주소:3000` 에 접속하고 Windows 방화벽에서 Node.js 허용이 필요합니다. 다만 **휴대폰 푸시와 홈 화면 앱 설치는 HTTPS 주소에서만** 동작하므로, 이 방식은 화면·기능 확인용입니다.

## 실행
```bash
npm install
npm run seed      # (선택) 개발용 샘플 가족 생성: mom@sample.test 등, 비밀번호 sample1234
npm start         # http://localhost:3000
npm test          # 서버 통합 테스트 24개
npm run test:ui   # 브라우저 E2E (Playwright 필요, 스크린샷은 SHOTS_DIR)
```
거실 iPad: 로그인 화면에서 "거실 공용 기기" 체크 후 로그인 → 공유 → 홈 화면에 추가.

## 활동(타이머) · 다음 활동 · 내일 준비물 · 가족 활동 (9~12)
> 화면에서는 ‘타이머’를 **활동**이라고 부릅니다. 기본 활동: 식사하기·TV 보기·게임하기(핸드폰)·양치하기(5분)·숙제하기·책 읽기·씻기(20분), 나머지는 30분. 가족 탭 → ‘활동 설정’에서 이름·시간을 바꿉니다. 아이별 그림은 `public/assets/act/{종류}-{yuel|yuha}.webp` (그림이 없는 조합 — 현재 유엘의 양치 — 은 이모지), 엄마·아빠의 ‘일하는 중/집에 가는 중’ 방 그림은 `public/assets/chars/{mom|dad}-{work|car}.webp` 입니다.
- **집 안 표시**: 활동을 시작하면 그 아이 방의 캐릭터가 활동 그림으로 바뀌고, 방에 남은 시간·지난 시간·진행 막대가 1초마다 갱신됩니다. 활동이 끝나면 "⏰ 끝났어요"가 나오고, 확인하거나 새 활동을 시작하면 원래 모습으로 돌아옵니다.
- **어른 삭제**: 가족 탭 → 어른 옆 `🗑 삭제` (부모 권한 어른만, 본인은 불가). 로그인·알림 구독이 정리되고 그 어른에게 온 대기 요청은 취소됩니다.
- **타이머** (`server/services/timers.js`): 종료 시각(`ends_at`) 기준으로 남은 시간을 계산하므로 화면 이동·새로고침·잠금 해제 후에도 정확합니다. 서버가 1초마다 정리하며 5분 전 예고(설정 5분 이하는 생략)와 종료를 **정확히 한 번씩** 발생시키고(`warn_sent_for`/`end_sent_for`), 연장하면 새 종료 시각 기준으로 다시 계산합니다. 이미 지난 예고는 다시 띄우지 않고, 팝업의 [알겠어요]는 시간·루틴에 아무 영향이 없습니다. 아이별로 한 번에 하나, 진행 중 다른 활동은 확인 후 교체합니다.
- **알림 경로**: 앱이 열린 거실 iPad는 SSE 이벤트로 팝업 + 부드러운 알람(WebAudio, 가족 설정에서 끄기 가능). 앱이 닫혔거나 잠긴 경우는 **거실 기기로 등록된 푸시 구독**으로 전달합니다 — iPad에서 가족 탭 → 🔑 어른 확인 → 알림 허용. 잠금화면 문구는 "유하 · TV 보기 5분 남았어요" 수준입니다.
- **다음 활동**: 타이머 시작 시 어른이 오늘 미완료 루틴 또는 직접 입력을 고르면 아이 카드·예고·종료 팝업에 "지금 → 다음" 카드와 문구가 나옵니다. 타이머 종료/확인은 루틴 체크나 도장 요청을 만들지 않습니다.
- **내일 준비물** (`supplies.js`): 알림장 글 또는 직접 등록, 여러 개·여러 아이, 아이별 체크, 같은 글의 같은 준비물은 기존 항목 표시, KST 자정이 지나면 오늘로 이동. 루틴·도장 계산과 별개입니다.
- **이번 주 가족 활동** (`famact.js`): 아이별 선택, 어른이 날짜·시간 확정. (주, 후보)당 일정은 항상 1건이라 버튼을 여러 번 눌러도 중복되지 않고 변경은 같은 일정을 갱신합니다.

## 우리 집 그림 (거실 보드)
- 홈 화면에 미니어처 집 그림(`public/assets/house.webp`)과 가족 캐릭터(`public/assets/chars/` 의 gma·mom·dad·yuel·yuha)가 들어가고, 방마다 눌러 이동합니다: 맨 위 **거실**(달력), 중간 **유엘방·유하방·은행·도장**(아이 화면 / 도장판), 아래 **할머니방·엄마방·아빠방**(상태 바꾸기). 방 좌표는 `public/js/views/home.js` 의 `ROOMS`(그림 1086×1448 기준 %)에서 바꿀 수 있어요.
- **얼굴 사진**: 가족 탭 → 구성원 `수정` → 얼굴 사진을 올리면 해당 방과 카드에 원형으로 표시됩니다. 사진은 저장소가 아니라 서버의 비공개 저장소에 보관되고 가족만 볼 수 있어요. 코드·ZIP·GitHub에 얼굴 사진을 넣지 마세요.

## 가족 기기(iPad·휴대폰)가 함께 접속할 주소 만들기
**방법 A. 집 PC로 잠깐 써 보기 (무료, 계정 불필요)** — PC가 켜져 있는 동안만 동작하고, 주소는 켤 때마다 바뀝니다.
1. 앱을 실행해 둔 상태(`start-windows.bat`)에서, 다른 명령 프롬프트 창에 `winget install Cloudflare.cloudflared` 로 설치합니다.
2. `cloudflared tunnel --url http://localhost:3000` 을 실행하면 `https://무작위이름.trycloudflare.com` 주소가 나옵니다.
3. 이 주소를 iPad·가족 휴대폰 Safari에서 엽니다. (HTTPS라 홈 화면 추가와 푸시도 가능)

**방법 B. Fly.io에 올려 계속 쓰기 (가족용 고정 주소, 소액 과금 가능)**
1. https://fly.io 가입 후 `flyctl` 설치, `fly auth login`.
2. `fly.toml` 의 `app = "lovefamily"` 를 원하는 고유한 이름(소문자·숫자·하이픈만)으로 바꿉니다. 이미 누가 쓰는 이름이면 다른 이름을 쓰세요.
3. `fly launch --no-deploy --copy-config` → `fly volumes create lovefamily_data --size 1 --region nrt`
4. 푸시를 쓰려면 `npm run vapid` 로 키를 만들고 `fly secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:내메일`
5. `fly deploy` → 주소는 `https://앱이름.fly.dev`.
6. 접속 후 **새 가족 만들기**로 시작하고, 어른들은 가족 코드/초대 링크로 참여합니다. 거실 iPad는 로그인 때 "거실 공용 기기"를 체크하세요.
※ SQLite를 쓰므로 서버는 **한 대만** 유지하세요(`fly scale count 1`). 데이터 백업은 `fly ssh sftp` 등으로 `/data` 를 받아 두세요.

## Fly.io 자동 배포 (GitHub 푸시 → 배포)
`.github/workflows/fly-deploy.yml` 이 푸시할 때마다 Fly 로 배포합니다. 처음에 한 번만 아래를 해 주세요.
1. Fly 토큰 만들기: https://fly.io/dashboard → 왼쪽/위쪽 **Tokens**(또는 Account → Access Tokens)에서 앱 `lovefamily` 용 **Deploy token** 을 만들고 복사합니다. (명령줄이면 `fly tokens create deploy -a lovefamily`)
2. GitHub 저장소 **Settings → Secrets and variables → Actions → New repository secret** 에 이름 `FLY_API_TOKEN`, 값 = 복사한 토큰.
3. 저장소 **Actions** 탭 → **Fly Deploy** → **Run workflow** 로 첫 배포를 실행합니다. 이후에는 푸시하면 자동으로 배포돼요.
토큰은 비밀값입니다. 채팅·코드에 붙여 넣지 마세요.

## 환경변수 (비밀값은 코드에 없음)
| 이름 | 설명 |
|---|---|
| `PORT`, `HOST` | 기본 3000 / 0.0.0.0 |
| `DATA_DIR` | DB·사진 위치(영구 볼륨에 두세요) |
| `COOKIE_SECURE=1` | HTTPS 뒤에서 쿠키 Secure (프록시가 `X-Forwarded-Proto: https`를 주면 자동) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | 푸시. `npm run vapid`로 생성 |

## 배포·푸시 설정
1. HTTPS가 필요합니다(푸시·홈 화면 앱 조건). Docker(`Dockerfile`)로 Fly.io/Render/집 서버 등에 올리고 `/data`에 볼륨을 연결하세요.
2. `npm run vapid` 결과를 환경변수에 설정하고 재시작.
3. 각자 iPhone에서 Safari로 접속 → 공유 → **홈 화면에 추가** → 홈 화면 아이콘으로 열기 → 가족 탭 → **알림 허용**. (iOS 16.4 이상, 홈 화면 앱에서만 푸시 가능)
4. 잠금화면에는 "유엘 · 도장 확인 요청"처럼 이름/종류만 표시되고, 본문·사진·금액은 앱에서만 보입니다.
5. 백업: `DATA_DIR` 폴더(SQLite + photos)를 주기적으로 복사하세요.

## 주요 규칙 구현 위치
- 도장·보상: `server/services/stamps.js` (승인=단일 트랜잭션, `board_rewards` 로 보상 적립/회수 복구, 정정 시 조정·정산 내역)
- 장부·잠금: `server/services/money.js` (사용 가능 = 잔액 − 목표 배정 − 승인된 출금 잠금)
- 루틴 스냅샷: `server/services/routines.js` (수정은 다음 해당 요일부터, 과거 기록 보존, 오늘 예외는 승인 전만)
- 권한: `server/ctx.js` (가족 소속·어른/아이·재인증·아이 PIN)
