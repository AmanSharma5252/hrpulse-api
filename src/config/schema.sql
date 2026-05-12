-- ================================================================
-- HRPulse v3 — Complete Supabase Schema
-- Paste into: Supabase Dashboard → SQL Editor → Run All
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
                    CHECK (role IN ('employee','manager','hr','admin')),
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

-- Auto-create profile row when auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE code TEXT;
BEGIN
  SELECT 'E' || LPAD((COUNT(*)+1)::TEXT,3,'0') INTO code FROM public.profiles;
  INSERT INTO public.profiles (id, full_name, avatar_initials, employee_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    UPPER(LEFT(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),2)),
    code
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

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
CREATE TABLE IF NOT EXISTS public.attendance (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

-- Auto-compute work_minutes on checkout
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
CREATE TABLE IF NOT EXISTS public.qr_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token      TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES auth.users(id),
  company_id UUID REFERENCES public.companies(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Leave Types ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES public.companies(id),
  name          TEXT NOT NULL,
  default_days  INTEGER DEFAULT 0,
  is_paid       BOOLEAN DEFAULT TRUE,
  carry_forward BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Leave Balances ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_balances (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  leave_type_id  UUID NOT NULL REFERENCES public.leave_types(id),
  year           INTEGER NOT NULL,
  total_days     INTEGER DEFAULT 0,
  used_days      INTEGER DEFAULT 0,
  pending_days   INTEGER DEFAULT 0,
  UNIQUE (employee_id, leave_type_id, year)
);

-- ── Leave Requests ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id    UUID REFERENCES public.companies(id),
  leave_type_id UUID REFERENCES public.leave_types(id),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  total_days    INTEGER NOT NULL,
  reason        TEXT,
  status        TEXT DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by   UUID REFERENCES auth.users(id),
  review_note   TEXT,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Payroll Records ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES auth.users(id),
  company_id       UUID REFERENCES public.companies(id),
  month            INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year             INTEGER NOT NULL,
  basic_salary     NUMERIC(12,2) DEFAULT 0,
  hra              NUMERIC(12,2) DEFAULT 0,
  ta               NUMERIC(12,2) DEFAULT 0,
  gross            NUMERIC(12,2) DEFAULT 0,
  pf_deduction     NUMERIC(12,2) DEFAULT 0,
  tax_deduction    NUMERIC(12,2) DEFAULT 0,
  absent_deduction NUMERIC(12,2) DEFAULT 0,
  late_deduction   NUMERIC(12,2) DEFAULT 0,
  total_deductions NUMERIC(12,2) DEFAULT 0,
  net_pay          NUMERIC(12,2) DEFAULT 0,
  days_present     INTEGER DEFAULT 0,
  days_absent      INTEGER DEFAULT 0,
  days_late        INTEGER DEFAULT 0,
  working_days     INTEGER DEFAULT 0,
  total_hours      NUMERIC(8,2) DEFAULT 0,
  status           TEXT DEFAULT 'draft' CHECK (status IN ('draft','processed','paid')),
  processed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, month, year)
);

-- ── Announcements ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id),
  created_by UUID REFERENCES auth.users(id),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  tag        TEXT DEFAULT 'General',
  is_urgent  BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tasks ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assigned_to UUID REFERENCES auth.users(id),
  assigned_by UUID REFERENCES auth.users(id),
  company_id  UUID REFERENCES public.companies(id),
  title       TEXT NOT NULL,
  deadline    DATE,
  priority    TEXT DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  progress    INTEGER DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Audit Logs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action     TEXT NOT NULL,
  actor_id   UUID,
  target_id  UUID,
  meta       JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE public.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own profile"    ON public.profiles       FOR ALL    USING (auth.uid() = id);
CREATE POLICY "own attendance" ON public.attendance     FOR ALL    USING (auth.uid() = employee_id);
CREATE POLICY "own leaves"     ON public.leave_requests FOR ALL    USING (auth.uid() = employee_id);
CREATE POLICY "own balances"   ON public.leave_balances FOR SELECT USING (auth.uid() = employee_id);
CREATE POLICY "own tasks"      ON public.tasks          FOR SELECT USING (auth.uid() = assigned_to);

-- ── Default Leave Types ───────────────────────────────────────
INSERT INTO public.leave_types (name, default_days, is_paid, carry_forward) VALUES
  ('Annual Leave',    18, TRUE,  TRUE),
  ('Sick Leave',      12, TRUE,  FALSE),
  ('Casual Leave',     6, TRUE,  FALSE),
  ('Maternity Leave', 90, TRUE,  FALSE),
  ('Unpaid Leave',     0, FALSE, FALSE)
ON CONFLICT DO NOTHING;

-- ── Storage Bucket ────────────────────────────────────────────
-- Go to Supabase Dashboard → Storage → New bucket
-- Name: hrpulse-assets   Public: YES
