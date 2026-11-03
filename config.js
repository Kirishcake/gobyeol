// 고양이별 설정 — Supabase 프로젝트를 만든 뒤 아래 두 값을 바꿔 넣으세요.
// (Supabase 대시보드 → Project Settings → API Keys. Legacy API Keys 탭의 anon 키를 추천, 없으면 sb_publishable_ 키)
// service_role / sb_secret_ 키는 절대 넣지 마세요.
window.GOBYEOL_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-ID.supabase.co",
  supabaseAnonKey: "YOUR-ANON-PUBLIC-KEY",

  // 고양이 편지를 Claude가 쓰게 하려면 Edge Function(cat-letter)을 배포한 뒤 true로 바꾸세요.
  // false면 사이트에 들어 있는 문장 꾸러미로 편지를 만듭니다.
  letterFunction: false
};
