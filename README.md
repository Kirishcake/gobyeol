# 고양이별 — 혼자 운영하는 사이트로 옮기기

링크만 있으면 누구나 들어와서 아바타로 함께 걷고, 대화하고, 자기 고양이를 등록할 수 있는 버전이에요.
claude.ai 없이 **Supabase**(무료로 시작 가능한 데이터베이스·실시간·사진 저장 서비스)와 아무 정적 호스팅(Netlify 등)으로 돌아가요.

## 들어 있는 파일

| 파일 | 하는 일 |
|---|---|
| `index.html` | 고양이별 화면 전체 (3D, 만남 공원, 사진첩, 대화 등) |
| `config.js` | Supabase 주소와 키를 넣는 곳 |
| `backend.js` | 화면과 Supabase를 이어주는 부분 (로그인, 기록, 실시간, 사진) |
| `supabase.sql` | 데이터베이스·접근 규칙·사진 저장소를 한 번에 만드는 SQL |
| `supabase/functions/cat-letter/` | (선택) 고양이 편지를 Claude가 쓰게 하는 서버 함수 |

## 0. 먼저 체험해 보기 (설정 없이)

`config.js`를 고치기 전에도 사이트는 열려요. 이때는 **체험 모드**라서, 혼자 모든 기능을 써 볼 수 있지만 기록은 그 브라우저에만 저장되고 다른 사람과 만날 수는 없어요. 화면 아래에 "체험 모드" 표시가 떠요.

## 1. Supabase 준비 (10분) — 여러 사람이 함께 쓰려면 꼭 필요해요

1. https://supabase.com 에 가입하고 **New project**를 만들어요.
   - 이름: 아무거나 (예: gobyeol) · 비밀번호: 아무거나 길게 · 지역: `Northeast Asia (Seoul)`
2. 프로젝트가 만들어지면(1~2분) 왼쪽 메뉴 **SQL Editor → New query**에 `supabase.sql` 내용을 전부 붙여넣고 **Run**.
   - "Success"가 뜨면 성공이에요.
3. 왼쪽 **Authentication → Sign In / Providers**에서 **Allow anonymous sign-ins**를 켜고 저장해요.
4. 왼쪽 아래 **Project Settings → API Keys**로 가요.
   - `Project URL`(https://무언가.supabase.co)은 **Project Settings → Data API**(또는 같은 화면 위쪽)에 있어요.
   - 키는 **Legacy API Keys** 탭의 `anon` `public` 키(eyJ…로 시작하는 긴 글자)를 추천해요. 이 사이트에 넣은 Supabase 라이브러리 버전과 가장 확실하게 맞아요.
   - 그 탭이 없으면 `sb_publishable_…`로 시작하는 **Publishable key**를 넣어도 돼요.
   두 값을 `config.js`의 두 칸에 붙여넣어요.
   - ⚠️ `service_role`이나 `sb_secret_…` 키는 절대 넣지 마세요. 공개돼도 괜찮은 건 `anon`/`publishable` 키뿐이에요.

## 2. 사이트 올리기 — GitHub Pages (10분, 무료)

1. https://github.com 에 로그인 → 오른쪽 위 **+ → New repository**.
   - Repository name: `gobyeol` · **Public** 선택 · **Create repository**.
2. 새 저장소 화면에서 **uploading an existing file** 링크를 눌러요.
3. 압축을 푼 `gobyeol-site` 폴더 **안의 파일과 폴더를 전부** 끌어다 놓아요.
   (`index.html`, `config.js`, `backend.js`, `supabase.sql`, `README.md`, `supabase` 폴더)
   → 아래 **Commit changes**.
4. 저장소 위쪽 **Settings → 왼쪽 Pages**.
   - Source: **Deploy from a branch** · Branch: **main**, 폴더 **/ (root)** → **Save**.
5. 1~3분 뒤 같은 화면 위쪽에 주소가 떠요: `https://내아이디.github.io/gobyeol/`
   이 링크를 보내면 누구나 들어올 수 있어요.

나중에 고칠 때는 저장소에서 파일을 다시 올리면(같은 이름이면 덮어써져요) 1~2분 뒤 반영돼요.

> 다른 방법: https://app.netlify.com/drop 에 폴더를 통째로 끌어다 놓아도 돼요. 단, 로그인하지 않으면 1시간 뒤 사라지니 가입 후 올려 주세요.

## 3. 나를 관리자로 등록하기

관리자는 처음부터 있는 고양이 5마리 화단을 고치거나 지울 수 있고, 문제가 되는 기록을 정리할 수 있어요.

1. 내 사이트에 들어가서 다리를 건너요.
2. 맨 위 **내 이름** 버튼 → 패널에 보이는 **내 사용자 ID**를 복사해요.
3. Supabase **SQL Editor**에서 아래를 실행해요.
   ```sql
   insert into public.admins (user_id) values ('복사한-ID');
   ```
4. 사이트를 새로고침하면 끝.

## 4. (선택) 고양이 편지를 Claude가 쓰게 하기

이걸 안 해도 편지는 와요. 사이트에 들어 있는 큰 문장 꾸러미로 겹치지 않게 만들어요.
매번 완전히 새로 쓴 편지를 원하면:

1. https://console.anthropic.com 에서 API 키를 만들어요. (사용량만큼 요금이 나가요)
2. 컴퓨터에 Supabase CLI를 설치하고 이 폴더에서:
   ```bash
   supabase login
   supabase link --project-ref 내-프로젝트-ID
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy cat-letter
   ```
3. `config.js`의 `letterFunction`을 `true`로 바꾸고 다시 올려요.

API 키는 서버(함수)에만 있고 브라우저로는 절대 나가지 않아요. 편지 내용도 서버에서 정해진 형식으로만 만들어서, 남이 키를 다른 용도로 쓰지 못해요.

## 알아 두면 좋은 것

- **로그인 방식**: 지금은 익명 로그인이라 같은 브라우저에서는 같은 사람으로 기억되지만, 브라우저나 기기를 바꾸면 새 사람이 돼요. 자기 고양이를 오래 돌보려면 나중에 카카오·구글 로그인을 붙이는 걸 추천해요. Supabase에서 켜고 `backend.js`에 몇 줄 더하면 돼요.
- **기존 시범 데이터**: claude.ai에서 팀원들이 등록한 고양이와 사진은 계정 체계가 달라서 자동으로 옮겨지지 않아요. 처음 5마리만 새 사이트에 들어가 있어요. 사진은 새로 올려 주세요.
- **몇 명까지 되나요?**
  - 사이트 파일(GitHub Pages·Netlify)은 사실상 제한이 없어요. GitHub Pages는 한 달 100GB 전송 정도가 기준이에요.
  - 실제 한도는 Supabase 실시간 연결이에요. 무료 요금제는 **동시 접속 200명**, Pro는 500명이에요(더 필요하면 늘릴 수 있어요).
  - 다만 여러 사람이 **동시에 움직이면** 움직임 메시지가 늘어나서, 무료 요금제에서는 한 공간에서 함께 돌아다니는 사람이 대략 **10명 안팎**일 때 가장 부드러워요. 그 이상이 자주 모이면 Pro 요금제를 추천해요.
  - 사진 저장은 무료 1GB, Pro 100GB예요.
- **공개 서비스 운영**: 누구나 들어올 수 있으니 욕설·스팸 신고, 차단 기능, 개인정보 처리방침을 꼭 준비해 주세요. 반려동물을 잃은 분들이 오는 공간이라 운영 정책이 특히 중요해요.
- **화면 고치기**: `index.html` 하나에 화면이 모두 들어 있어요. 고친 뒤 폴더를 다시 끌어다 놓으면 바로 반영돼요.
