-- ================================================================
-- HRPulse v3 — Fixed Supabase Schema
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Companies ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.companies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  industry   TEXT,
  size       TEXT,
  timezone   TEXT DEFAULT 'Asia/Kolkata',
  logo_url   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Profiles (extends auth.users) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_code     TEXT UNIQUE,
  full_name         TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'employee'
                    CHECK (role IN ('employee','manager','hr','admin','super_admin')),
  department        TEXT,
  title             TEXT,
  phone             TEXT,
  emergency_contact TEXT,
  avatar_initials   TEXT,
  hire_date         DATE,
  company_id        UUID REFERENCES public.companies(id),
  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- FIX #4: Safe employee code using a sequence instead of COUNT(*)
CREATE SEQUENCE IF NOT EXISTS public.employee_code_seq START 1;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_initials, employee_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    UPPER(LEFT(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), 2)),
    'E' || LPAD(nextval('public.employee_code_seq')::TEXT, 3, '0')
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- FIX #5: Auto-update updated_at on profiles
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── Office Locations ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.office_locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id),
  name       TEXT NOT NULL DEFAULT 'Head Office',
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  radius_m   INTEGER DEFAULT 100,
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Attendance ────────────────────────────────────────────────
-- FIX #1: employee_id now references public.profiles(id)
CREATE TABLE IF NOT EXISTS public.attendance (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id     UUID REFERENCES public.companies(id),
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in       TIMESTAMPTZ,
  check_out      TIMESTAMPTZ,
  work_minutes   INTEGER DEFAULT 0,
  latitude       DOUBLE PRECISION,
  longitude      DOUBLE PRECISION,
  check_out_lat  DOUBLE PRECISION,
  check_out_lng  DOUBLE PRECISION,
  selfie_in      TEXT,
  selfie_out     TEXT,
  status         TEXT DEFAULT 'present'
                 CHECK (status IN ('present','late','absent','on-leave','half-day')),
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, date)
);

CREATE OR REPLACE FUNCTION public.compute_work_minutes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.check_out IS NOT NULL AND NEW.check_in IS NOT NULL THEN
    NEW.work_minutes := GREATEST(0, EXTRACT(EPOCH FROM (NEW.check_out - NEW.check_in))::INTEGER / 60);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_work_minutes ON public.attendance;
CREATE TRIGGER trg_work_minutes
  BEFORE UPDATE ON public.attendance
  FOR EACH ROW EXECUTE PROCEDURE public.compute_work_minutes();

-- ── QR Sessions ───────────────────────────────────────────────
-- FIX #2: created_by references profiles
CREATE TABLE IF NOT EXISTS public.qr_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_rand
