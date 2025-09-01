-- Create profiles table (extends auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT CHECK (role IN ('patient', 'doctor')) DEFAULT 'patient',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create BAC readings table
CREATE TABLE public.bac_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  value DECIMAL NOT NULL,
  unit TEXT CHECK (unit IN ('mg/dL', 'mmol/L')) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  source TEXT CHECK (source IN ('manual', 'device')) DEFAULT 'manual',
  device_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create symptom entries table
CREATE TABLE public.symptom_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symptom_id TEXT NOT NULL,
  value TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('slight', 'moderate', 'severe')),
  location TEXT,
  video_url TEXT,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create carb entries table
CREATE TABLE public.carb_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL NOT NULL,
  description TEXT,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create session entries table
CREATE TABLE public.session_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  bac_reading_id UUID REFERENCES public.bac_readings(id),
  notes TEXT,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- ============================================================
--  Custom Symptoms Builder
-- ============================================================

CREATE TABLE public.custom_symptoms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK (
    type IN (
      'boolean',
      'severity',
      'location',
      'video_assessment',
      'carb_entry',
      'notes'
    )
  ) NOT NULL,
  options JSONB,
  video_prompt TEXT,
  description TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- ============================================================
--  Enable Row Level Security
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bac_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symptom_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carb_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_symptoms ENABLE ROW LEVEL SECURITY;

-- ============================================================
--  RLS Policies
-- ============================================================

-- Profiles
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- BAC readings
CREATE POLICY "Users can view own BAC readings" ON public.bac_readings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own BAC readings" ON public.bac_readings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own BAC readings" ON public.bac_readings
  FOR UPDATE USING (auth.uid() = user_id);

-- Symptom entries
CREATE POLICY "Users can view own symptom entries" ON public.symptom_entries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own symptom entries" ON public.symptom_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own symptom entries" ON public.symptom_entries
  FOR UPDATE USING (auth.uid() = user_id);

-- Carb entries
CREATE POLICY "Users can view own carb entries" ON public.carb_entries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own carb entries" ON public.carb_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own carb entries" ON public.carb_entries
  FOR UPDATE USING (auth.uid() = user_id);

-- Session entries
CREATE POLICY "Users can view own session entries" ON public.session_entries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own session entries" ON public.session_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own session entries" ON public.session_entries
  FOR UPDATE USING (auth.uid() = user_id);

-- Custom symptoms
CREATE POLICY "Users can view own custom symptoms" ON public.custom_symptoms
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own custom symptoms" ON public.custom_symptoms
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own custom symptoms" ON public.custom_symptoms
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own custom symptoms" ON public.custom_symptoms
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
--  Functions and Triggers
-- ============================================================

-- Function: create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'firstName', ''),
    COALESCE(NEW.raw_user_meta_data->>'lastName', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'patient')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: on signup, insert profile
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Function: auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: updated_at for profiles
CREATE TRIGGER handle_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- Trigger: updated_at for custom_symptoms
CREATE TRIGGER handle_updated_at_custom_symptoms
  BEFORE UPDATE ON public.custom_symptoms
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================
--  Indexes
-- ============================================================

CREATE INDEX idx_custom_symptoms_user_id ON public.custom_symptoms(user_id);
CREATE INDEX idx_custom_symptoms_active ON public.custom_symptoms(user_id, is_active);
