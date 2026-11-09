-- =====================================================================
-- LiberiaRide · 0014 · Storage buckets and object policies
--   driver-documents : PRIVATE. Driver uploads into "<uid>/...", reads own; staff read all.
--                      No client update/delete — submitted evidence is immutable.
--   avatars          : public read; users write only "<uid>/..." in their folder.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('driver-documents', 'driver-documents', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('avatars', 'avatars', true, 2097152,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy driver_documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'driver-documents'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.has_role('driver'));
create policy driver_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'driver-documents'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_staff()));

create policy avatars_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
