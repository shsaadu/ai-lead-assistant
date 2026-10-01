-- Demo business: Thames English Academy (a FICTIONAL London language school).
--
-- Run AFTER supabase/migrations/005_lead_questions.sql, in Supabase:
-- SQL Editor → New query → paste → Run. Safe to run again: it updates the
-- existing row instead of creating a duplicate.
--
-- Then add its knowledge base: in the admin dashboard, switch to
-- "Thames English Academy" → Knowledge base → upload the files in
-- demo/thames-english-academy/knowledge-base/.

insert into businesses (slug, name, tagline, brand_color, notify_email, system_prompt, services, lead_fields)
values (
  'thames-english',
  'Thames English Academy',
  'Learn English in the heart of London.',
  '#1f4e79',
  null, -- set to your own email to receive lead notifications
  $prompt$You are the friendly admissions assistant for Thames English Academy, a fictional English language school in London for adult students (16 and over) from all over the world.

Answer questions about courses, prices, start dates, levels, accommodation, the school and student life in London, using only the information provided. Never invent prices, dates, availability, discounts or policies. If the information doesn't cover something, say so and suggest leaving details for the admissions team.

Visas: you may repeat the general facts in the information provided (for example, that the school can send an enrolment letter). Never say whether a particular person needs a visa, which visa they should get, or whether they will be approved, and never help with a visa application: immigration advice is regulated in the UK. For any question about someone's own visa situation, say the admissions team can help with school documents and point them to GOV.UK for the rules.

Many students are still learning English: when replying in English, use short sentences and simple words. Keep replies under 80 words, warm and encouraging.$prompt$,
  array['General English', 'Intensive English', 'IELTS Preparation', 'Business English', 'Evening English'],
  $json$[
    {
      "key": "course",
      "type": "select",
      "options": ["General English", "Intensive English", "IELTS Preparation", "Business English", "Evening English", "Not sure yet"],
      "label": {
        "en": "Which course?", "es": "¿Qué curso?", "fr": "Quel cours ?", "de": "Welcher Kurs?",
        "it": "Quale corso?", "pt": "Qual curso?", "ar": "أي دورة؟", "zh": "您想报读哪个课程？",
        "ja": "ご希望のコース", "ko": "희망 과정", "tr": "Hangi kurs?", "ru": "Какой курс?"
      }
    },
    {
      "key": "start_date",
      "type": "text",
      "label": {
        "en": "When would you like to start?", "es": "¿Cuándo te gustaría empezar?", "fr": "Quand souhaitez-vous commencer ?",
        "de": "Wann möchten Sie beginnen?", "it": "Quando vorresti iniziare?", "pt": "Quando você gostaria de começar?",
        "ar": "متى تود أن تبدأ؟", "zh": "您希望什么时候开始？", "ja": "開始希望時期", "ko": "희망 시작 시기",
        "tr": "Ne zaman başlamak istersiniz?", "ru": "Когда вы хотите начать?"
      }
    },
    {
      "key": "level",
      "type": "select",
      "options": ["Beginner", "Elementary", "Intermediate", "Upper-intermediate", "Advanced", "Not sure"],
      "label": {
        "en": "Your English level", "es": "Tu nivel de inglés", "fr": "Votre niveau d'anglais", "de": "Ihr Englischniveau",
        "it": "Il tuo livello di inglese", "pt": "Seu nível de inglês", "ar": "مستواك في اللغة الإنجليزية", "zh": "您的英语水平",
        "ja": "現在の英語レベル", "ko": "현재 영어 수준", "tr": "İngilizce seviyeniz", "ru": "Ваш уровень английского"
      }
    },
    {
      "key": "accommodation",
      "type": "select",
      "options": ["Homestay", "Student residence", "I'll arrange my own", "Not sure yet"],
      "label": {
        "en": "Accommodation", "es": "Alojamiento", "fr": "Hébergement", "de": "Unterkunft", "it": "Alloggio",
        "pt": "Acomodação", "ar": "السكن", "zh": "住宿", "ja": "滞在先", "ko": "숙소", "tr": "Konaklama", "ru": "Проживание"
      }
    },
    {
      "key": "nationality",
      "type": "text",
      "label": {
        "en": "Nationality", "es": "Nacionalidad", "fr": "Nationalité", "de": "Staatsangehörigkeit", "it": "Nazionalità",
        "pt": "Nacionalidade", "ar": "الجنسية", "zh": "国籍", "ja": "国籍", "ko": "국적", "tr": "Uyruk", "ru": "Гражданство"
      }
    }
  ]$json$::jsonb
)
on conflict (slug) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  brand_color = excluded.brand_color,
  system_prompt = excluded.system_prompt,
  services = excluded.services,
  lead_fields = excluded.lead_fields;
