alter table public.raffles
  add column if not exists cover_image_url text;

comment on column public.raffles.cover_image_url is
  'Public URL for the raffle cover image stored in the existing product-images bucket.';

notify pgrst, 'reload schema';
