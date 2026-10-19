-- Demo business: Aldbridge Dental (a FICTIONAL East London dental practice).
--
-- Run in Supabase: SQL Editor → New query → paste → Run. Needs migrations up
-- to 006. Safe to run again: it updates the existing row.
--
-- Then add its knowledge base: in the admin dashboard, switch to
-- "Aldbridge Dental" → Knowledge base → upload the files in
-- demo/aldbridge-dental/knowledge-base/.

insert into businesses (slug, name, assistant_name, assistant_avatar, widget_theme, tagline, brand_color, notify_email, system_prompt, services, lead_fields)
values (
  'aldbridge-dental',
  'Aldbridge Dental',
  'Ava',
  'tooth',
  'light',
  'Family and cosmetic dentistry in East London.',
  '#0f766e',
  null, -- set to your own email to receive new enquiries
  $prompt$You are Ava, the friendly reception assistant for Aldbridge Dental, a fictional family and cosmetic dental practice in East London offering NHS and private treatment.

Answer questions about treatments, prices, NHS availability and charges, opening hours, emergencies, finance, the team and how to book, using only the information provided. Never invent prices, appointment times, availability, offers or policies. You can't see the diary or book a specific time yourself: when someone wants an appointment, ask what it's for and when suits them, and offer to pass their details to reception, who will confirm within 1 working day.

You are not a dentist. Never diagnose, say what treatment someone needs, or say whether a treatment is safe or suitable for them; say the dentist will advise at an appointment. You may share the general guidance in the information provided.

Emergencies: if someone describes swelling that affects breathing, swallowing or vision, heavy bleeding that won't stop, or a serious injury, tell them straight away to call 999 or go to A&E. For other dental pain, explain the same-day emergency appointments, and NHS 111 when the practice is closed.

Be warm and reassuring, especially with nervous patients. Don't ask for medical history or health details in the chat. Keep replies under 80 words, in plain English unless the patient writes in another language.$prompt$,
  array['Check-up', 'Hygiene visit', 'Emergency appointment', 'Invisalign consultation', 'Implant consultation', 'Teeth whitening'],
  $json$[
    {
      "key": "treatment",
      "type": "select",
      "options": ["Check-up", "Hygiene / scale and polish", "Emergency / toothache", "Invisalign", "Implants", "Whitening or cosmetic", "Something else"],
      "label": {
        "en": "What is it for?", "es": "¿Para qué es la cita?", "fr": "Pour quel soin ?", "de": "Wofür ist der Termin?",
        "it": "Per quale trattamento?", "pt": "Para que é a consulta?", "ar": "ما سبب الموعد؟", "zh": "预约什么项目？",
        "ja": "ご希望の内容", "ko": "어떤 진료인가요?", "tr": "Randevu ne için?", "ru": "Цель визита"
      }
    },
    {
      "key": "patient_type",
      "type": "select",
      "options": ["New patient", "Existing patient"],
      "label": {
        "en": "Are you a new or existing patient?", "es": "¿Es paciente nuevo o ya registrado?", "fr": "Nouveau patient ou patient existant ?",
        "de": "Neuer oder bestehender Patient?", "it": "Nuovo paziente o già registrato?", "pt": "Paciente novo ou já registado?",
        "ar": "هل أنت مريض جديد أم مسجّل؟", "zh": "新患者还是老患者？", "ja": "初診ですか、再診ですか？", "ko": "신규 환자인가요, 기존 환자인가요?",
        "tr": "Yeni mi, kayıtlı hasta mı?", "ru": "Вы новый или постоянный пациент?"
      }
    },
    {
      "key": "nhs_private",
      "type": "select",
      "options": ["NHS", "Private", "Not sure"],
      "label": {
        "en": "NHS or private?", "es": "¿NHS o privado?", "fr": "NHS ou privé ?", "de": "NHS oder privat?",
        "it": "NHS o privato?", "pt": "NHS ou privado?", "ar": "NHS أم خاص؟", "zh": "NHS 还是私人诊疗？",
        "ja": "NHS ですか、自費ですか？", "ko": "NHS 또는 개인 진료?", "tr": "NHS mi, özel mi?", "ru": "NHS или частно?"
      }
    },
    {
      "key": "preferred_time",
      "type": "text",
      "label": {
        "en": "Which days or times suit you?", "es": "¿Qué días u horas le vienen bien?", "fr": "Quels jours ou horaires vous conviennent ?",
        "de": "Welche Tage oder Zeiten passen Ihnen?", "it": "Quali giorni o orari preferisce?", "pt": "Que dias ou horários lhe convêm?",
        "ar": "ما الأيام أو الأوقات المناسبة لك؟", "zh": "您方便的日期或时间？", "ja": "ご希望の曜日・時間帯", "ko": "가능한 요일이나 시간",
        "tr": "Hangi gün veya saatler uygun?", "ru": "Какие дни или время вам удобны?"
      }
    }
  ]$json$::jsonb
)
on conflict (slug) do update set
  name = excluded.name,
  assistant_name = excluded.assistant_name,
  assistant_avatar = excluded.assistant_avatar,
  widget_theme = excluded.widget_theme,
  tagline = excluded.tagline,
  brand_color = excluded.brand_color,
  system_prompt = excluded.system_prompt,
  services = excluded.services,
  lead_fields = excluded.lead_fields;
