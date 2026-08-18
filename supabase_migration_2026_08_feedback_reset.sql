-- ─────────────────────────────────────────────────────────────────────────────────────
-- Spätná väzba: vyčistenie pred ostrým používaním  (2026-08-18)
--
-- Doterajšie správy boli výhradne testovacie (Boss to potvrdil) a kategórie sa zúžili
-- zo šiestich na štyri. Táto migrácia teda:
--   1. zmaže všetky doterajšie vlákna aj správy v nich,
--   2. zúži povolené kategórie na tie štyri, ktoré widget ponúka.
--
-- Poradie je dôležité: constraint sa nedá zúžiť, kým v tabuľke ležia riadky so starou
-- kategóriou — preto najprv mazanie, až potom constraint.
--
-- Prílohy k správam ostávajú v Storage (bucket "feedback-attachments"); ak ich chceš
-- tiež preč, zmaž bucket ručne v Supabase → Storage.
-- ─────────────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) preč so všetkými testovacími správami
--    (feedback_messages má ON DELETE CASCADE, ale mažeme ho výslovne, nech je to čitateľné)
DELETE FROM public.feedback_messages;
DELETE FROM public.feedback;

-- 2) povolené kategórie = presne tie, ktoré sa dajú vybrať vo widgete
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_category_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_category_check
  CHECK (category IN ('bug','question','idea','other'));

COMMIT;

-- Kontrola po spustení — obe majú vrátiť 0:
--   SELECT count(*) FROM public.feedback;
--   SELECT count(*) FROM public.feedback_messages;
