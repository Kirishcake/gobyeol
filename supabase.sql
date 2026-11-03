-- 고양이별 데이터베이스 설정
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run 하세요. (여러 번 실행해도 괜찮아요)

-- 1) 모든 기록을 담는 표: 사람별 기록(people), 대화(chat), 처음부터 있는 고양이(examples)
create table if not exists public.docs (
  col        text not null,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  owner      uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
alter table public.docs replica identity full;

-- 2) 관리자 목록 (처음부터 있는 고양이 화단을 고치거나 지울 수 있는 사람)
create table if not exists public.admins (
  user_id uuid primary key
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- 3) 접근 규칙: 누구나 읽고, 각자 자기 기록만 쓰고, 관리자는 정리할 수 있어요
grant execute on function public.is_admin() to anon, authenticated;
alter table public.docs enable row level security;
alter table public.admins enable row level security;

-- 표를 웹에서 쓸 수 있게 권한을 직접 줘요 ("Automatically expose new tables"를 꺼 둬도 동작하도록)
-- 실제로 누가 무엇을 읽고 쓸 수 있는지는 아래 RLS 규칙이 정해요.
grant usage on schema public to anon, authenticated;
grant select on public.docs to anon, authenticated;
grant insert, update, delete on public.docs to authenticated;
grant select on public.admins to authenticated;

drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins for select to authenticated using (user_id = auth.uid());

-- 4) 실시간 변경 알림 켜기
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 5) 사진 저장소: 누구나 보기, 로그인한 사람(익명 포함)이 올리기, 자기 사진만 지우기
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 10485760, array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 10485760, allowed_mime_types = array['image/png','image/jpeg','image/gif','image/webp'];

drop policy if exists "photos read" on storage.objects;
create policy "photos read" on storage.objects for select using (bucket_id = 'photos');

-- 5-2) 신고 · 차단

-- 차단된 사람인지 확인 (관리자가 사이트에서 만든 차단 목록을 읽어요)
create or replace function public.is_blocked() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.docs d, jsonb_array_elements(coalesce(d.data->'blk','[]'::jsonb)) b
    where d.col = 'examples' and d.id = 'banned'
      and b->>'id' = auth.uid()::text
      and (coalesce((b->>'until')::bigint, 0) = 0 or (b->>'until')::bigint > (extract(epoch from now()) * 1000)::bigint)
  );
$$;
grant execute on function public.is_blocked() to anon, authenticated;

-- 읽기: 신고는 보낸 사람과 관리자만, 나머지는 누구나
drop policy if exists "read all" on public.docs;
create policy "read all" on public.docs for select
  using (col <> 'reports' or id = auth.uid()::text or public.is_admin());

-- 쓰기: 각자 자기 기록만 (차단된 사람은 못 씀). 관리자는 화단·대화·설정을 정리할 수 있어요
drop policy if exists "write own" on public.docs;
create policy "write own" on public.docs for insert to authenticated
  with check (
    (col in ('people','chat','reports') and id = auth.uid()::text and owner = auth.uid() and not public.is_blocked())
    or public.is_admin()
  );

drop policy if exists "update own" on public.docs;
create policy "update own" on public.docs for update to authenticated
  using ((col in ('people','chat','reports') and id = auth.uid()::text) or public.is_admin())
  with check ((col in ('people','chat','reports') and id = auth.uid()::text and owner = auth.uid() and not public.is_blocked())
              or public.is_admin());

drop policy if exists "delete own" on public.docs;
create policy "delete own" on public.docs for delete to authenticated
  using ((col in ('people','chat') and id = auth.uid()::text) or public.is_admin());

-- 사진: 차단된 사람은 못 올리고, 올린 사람과 관리자가 지울 수 있어요
drop policy if exists "photos upload" on storage.objects;
create policy "photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and not public.is_blocked());

drop policy if exists "photos delete own" on storage.objects;
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (owner = auth.uid() or public.is_admin()));

-- 6) 처음부터 있는 고양이 5마리 (원하지 않으면 이 부분은 빼고 실행하세요)
insert into public.docs (col, id, data, owner)
values ('examples', 'hall', '{"pets": {"hotteok": {"born": "2012-09-02", "breed": "", "coat": "삼색", "createdAt": 3, "kind": "고양이", "left": "2026-07-11", "letters": [{"d": "2026-08-29", "t": "호떡아, 오늘 장 보고 왔는데 봉지 소리에 자꾸 뒤를 돌아보게 돼."}], "name": "호떡", "story": "시장 골목에서 데려온 삼색이. 비닐봉지 소리만 나면 어디서든 달려왔어요.", "photo": null, "photos": []}, "kkami": {"born": "2010-05-05", "breed": "", "coat": "검은 고양이", "createdAt": 5, "kind": "고양이", "left": "2026-06-18", "letters": [{"d": "2026-08-06", "t": "까미야, 49일 동안 매일 불 켜 두었어. 이제 편히 쉬어."}], "name": "까미", "photo": null, "photos": [], "story": "밤이면 눈만 반짝이던 까만 고양이. 16년 동안 이불 발치를 지켜 줬어요."}, "moka": {"born": "2016-03-21", "breed": "러시안블루", "coat": "러시안블루", "createdAt": 2, "kind": "고양이", "left": "2026-10-27", "letters": [], "name": "모카", "story": "낯가림이 심했지만 한 번 마음을 열면 밤새 옆에서 골골거리던 아이.", "photo": null, "photos": []}, "nabi": {"born": "2014-06-10", "breed": "코리안숏헤어", "coat": "치즈", "createdAt": 1, "kind": "고양이", "left": "2026-10-05", "letters": [{"d": "2026-10-20", "t": "창가에 아직 네 털이 있어. 햇볕이 들면 반짝여."}], "name": "나비", "story": "창가 햇볕 자리를 지키던 치즈 고양이. 키보드 위에 누워 일을 못 하게 하는 게 특기였어요.", "photo": null, "photos": []}, "yangmal": {"born": "2018-01-15", "breed": "", "coat": "턱시도", "createdAt": 4, "kind": "고양이", "left": "2026-09-30", "letters": [], "name": "양말", "story": "네 발만 하얀 턱시도. 현관 신발장 위가 자기 자리라고 믿었어요.", "photo": null, "photos": []}}, "trib": {"ex~hotteok": {"flowers": {"국화": 5, "들꽃": 3, "해바라기": 2}, "fly": 26, "seeds": [], "water": 10}, "ex~kkami": {"flowers": {"국화": 6, "들꽃": 5, "해바라기": 3}, "fly": 40, "seeds": [], "water": 13}, "ex~moka": {"flowers": {"국화": 1, "들꽃": 0, "해바라기": 0}, "fly": 4, "seeds": [], "water": 1}, "ex~nabi": {"flowers": {"국화": 3, "들꽃": 4, "해바라기": 1}, "fly": 18, "seeds": [], "water": 7}, "ex~yangmal": {"flowers": {"국화": 2, "들꽃": 1, "해바라기": 1}, "fly": 11, "seeds": [], "water": 4}}}'::jsonb, null)
on conflict (col, id) do nothing;

-- 7) 관리자 등록: 사이트에 한 번 들어가서 [내 이름] 패널의 "내 사용자 ID"를 복사한 뒤,
--    아래 줄의 따옴표 안에 넣고 이 줄만 실행하세요.
-- insert into public.admins (user_id) values ('여기에-내-사용자-ID');
