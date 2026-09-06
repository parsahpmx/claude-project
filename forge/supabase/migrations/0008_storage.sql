-- FORGE Web Beta — 0008 storage buckets and policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('forge-private', 'forge-private', false, 26214400,
   array['image/jpeg','image/png','image/webp','image/heic','video/mp4','application/gpx+xml','application/octet-stream']),
  ('forge-public', 'forge-public', true, 10485760,
   array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do nothing;

-- Every private object is namespaced under the owner's uuid as the first path
-- segment, and the policy compares that segment to auth.uid(). A user cannot
-- touch anything outside their own prefix; anonymous access fails because
-- auth.uid() is null.
create policy "private objects readable by owner" on storage.objects for select
  using (bucket_id = 'forge-private' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "private objects writable by owner" on storage.objects for insert
  with check (bucket_id = 'forge-private' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "private objects updatable by owner" on storage.objects for update
  using (bucket_id = 'forge-private' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "private objects deletable by owner" on storage.objects for delete
  using (bucket_id = 'forge-private' and (select auth.uid())::text = (storage.foldername(name))[1]);

-- Public bucket holds editorial assets only. Writable by service-role, which
-- bypasses RLS, so no insert policy is granted to authenticated users.
create policy "public assets readable by anyone" on storage.objects for select
  using (bucket_id = 'forge-public');
