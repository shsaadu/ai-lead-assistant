/*
 * AI Lead Assistant — embeddable chat widget.
 *
 * Add to any website, just before </body>:
 *
 *   <script src="https://YOUR-DEPLOYMENT/widget.js" data-business="your-business-slug" async></script>
 *
 * Optional attributes:
 *   data-position="left"        put the button bottom-left instead of bottom-right
 *   data-greeting="Hi there!"   replace the first message shown in the chat
 *   data-label="Ask us"         replace the text on the chat button
 *   data-language="es"          start in this language instead of the visitor's browser language
 *
 * The widget's own text follows the visitor: it starts in their browser's
 * language and switches to whatever language they write in (12 languages
 * built in, right-to-left for Arabic). The assistant's replies already come
 * back in the visitor's language from the server.
 *
 * Everything renders inside a Shadow DOM, so the host page's CSS can't break
 * the widget and the widget's CSS can't leak into the page. Branding, services
 * and lead-form questions come from /api/config for that business.
 */
(function () {
  'use strict';

  if (window.__aiLeadAssistantLoaded) return;
  window.__aiLeadAssistantLoaded = true;

  var script =
    document.currentScript ||
    Array.prototype.slice.call(document.querySelectorAll('script[src*="widget.js"][data-business]')).pop();
  if (!script) return;

  var business = script.getAttribute('data-business');
  if (!business) {
    console.warn('[AI assistant widget] Add data-business="your-business-slug" to the script tag.');
    return;
  }

  var API_BASE = new URL(script.src, window.location.href).origin;
  var POSITION = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var STORAGE_KEY = 'ai-lead-assistant:' + business + ':conversation';
  var MESSAGES_BEFORE_REOFFER = 3;
  var DEFAULT_COLOR = '#1d4ed8';
  var RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'];

  // ---- Interface text ----
  // {name} is replaced with the business name.
  var I18N = {
    en: {
      launcher: 'Chat with us', openChat: 'Open chat', closeChat: 'Close chat', subtitle: 'Usually replies in seconds',
      placeholder: 'Type your message…', sendMessage: 'Send message', typing: 'Assistant is typing',
      note: 'AI assistant. The team may review this chat to follow up on your enquiry.',
      greeting: 'Hi! I can answer questions about {name}. What can I help you with?',
      leadTitle: 'Where should the team reply?', leadIntro: 'Leave your details and someone will get back to you shortly.',
      name: 'Name', email: 'Email', phone: 'Phone / WhatsApp', contactHint: 'Email or phone — one is enough.',
      message: 'Message', service: 'What do you need?', notSure: 'Not sure yet', notNow: 'Not now', submit: 'Send',
      contactRequired: 'Please give an email address or a phone number.',
      thanks: 'Thanks! Your details have been sent, and the team will be in touch shortly.',
      sendError: 'Could not send your details. Please try again.',
      reachError: 'Could not reach the server. Please try again in a moment.',
      serverDown: "Sorry, I couldn't reach the server. Please leave your details and the team will follow up.",
      noReply: "Sorry, I couldn't process that. Please try again."
    },
    es: {
      launcher: 'Chatea con nosotros', openChat: 'Abrir chat', closeChat: 'Cerrar chat', subtitle: 'Suele responder en segundos',
      placeholder: 'Escribe tu mensaje…', sendMessage: 'Enviar mensaje', typing: 'El asistente está escribiendo',
      note: 'Asistente de IA. El equipo puede revisar esta conversación para dar seguimiento a tu consulta.',
      greeting: '¡Hola! Puedo responder preguntas sobre {name}. ¿En qué te puedo ayudar?',
      leadTitle: '¿Dónde te respondemos?', leadIntro: 'Déjanos tus datos y alguien se pondrá en contacto contigo pronto.',
      name: 'Nombre', email: 'Correo electrónico', phone: 'Teléfono / WhatsApp', contactHint: 'Correo o teléfono: con uno es suficiente.',
      message: 'Mensaje', service: '¿Qué necesitas?', notSure: 'Aún no lo sé', notNow: 'Ahora no', submit: 'Enviar',
      contactRequired: 'Indica un correo electrónico o un número de teléfono.',
      thanks: '¡Gracias! Hemos recibido tus datos y el equipo se pondrá en contacto contigo pronto.',
      sendError: 'No se pudieron enviar tus datos. Inténtalo de nuevo.',
      reachError: 'No se pudo conectar con el servidor. Inténtalo de nuevo en un momento.',
      serverDown: 'Lo siento, no pude conectar con el servidor. Déjanos tus datos y el equipo te contactará.',
      noReply: 'Lo siento, no pude procesar eso. Inténtalo de nuevo.'
    },
    fr: {
      launcher: 'Discutons', openChat: 'Ouvrir le chat', closeChat: 'Fermer le chat', subtitle: 'Répond généralement en quelques secondes',
      placeholder: 'Écrivez votre message…', sendMessage: 'Envoyer le message', typing: "L'assistant écrit",
      note: "Assistant IA. L'équipe peut consulter cette conversation pour donner suite à votre demande.",
      greeting: 'Bonjour ! Je peux répondre à vos questions sur {name}. Comment puis-je vous aider ?',
      leadTitle: "Où l'équipe peut-elle vous répondre ?", leadIntro: "Laissez vos coordonnées et quelqu'un vous recontactera rapidement.",
      name: 'Nom', email: 'E-mail', phone: 'Téléphone / WhatsApp', contactHint: 'E-mail ou téléphone : un seul suffit.',
      message: 'Message', service: 'De quoi avez-vous besoin ?', notSure: 'Je ne sais pas encore', notNow: 'Pas maintenant', submit: 'Envoyer',
      contactRequired: 'Veuillez indiquer une adresse e-mail ou un numéro de téléphone.',
      thanks: "Merci ! Vos coordonnées ont été envoyées et l'équipe vous contactera rapidement.",
      sendError: "Impossible d'envoyer vos coordonnées. Veuillez réessayer.",
      reachError: 'Impossible de joindre le serveur. Veuillez réessayer dans un instant.',
      serverDown: "Désolé, je n'ai pas pu joindre le serveur. Laissez vos coordonnées et l'équipe vous recontactera.",
      noReply: "Désolé, je n'ai pas pu traiter votre message. Veuillez réessayer."
    },
    de: {
      launcher: 'Chatten Sie mit uns', openChat: 'Chat öffnen', closeChat: 'Chat schließen', subtitle: 'Antwortet meist in Sekunden',
      placeholder: 'Nachricht eingeben…', sendMessage: 'Nachricht senden', typing: 'Der Assistent schreibt',
      note: 'KI-Assistent. Das Team kann diesen Chat einsehen, um Ihre Anfrage zu bearbeiten.',
      greeting: 'Hallo! Ich beantworte gern Fragen zu {name}. Wie kann ich helfen?',
      leadTitle: 'Wie kann Sie das Team erreichen?', leadIntro: 'Hinterlassen Sie Ihre Kontaktdaten, und wir melden uns in Kürze.',
      name: 'Name', email: 'E-Mail', phone: 'Telefon / WhatsApp', contactHint: 'E-Mail oder Telefon – eines genügt.',
      message: 'Nachricht', service: 'Was benötigen Sie?', notSure: 'Noch nicht sicher', notNow: 'Nicht jetzt', submit: 'Senden',
      contactRequired: 'Bitte geben Sie eine E-Mail-Adresse oder Telefonnummer an.',
      thanks: 'Danke! Ihre Daten wurden gesendet, und das Team meldet sich in Kürze.',
      sendError: 'Ihre Daten konnten nicht gesendet werden. Bitte versuchen Sie es erneut.',
      reachError: 'Der Server ist nicht erreichbar. Bitte versuchen Sie es gleich noch einmal.',
      serverDown: 'Der Server ist leider nicht erreichbar. Hinterlassen Sie Ihre Kontaktdaten, und das Team meldet sich.',
      noReply: 'Das konnte ich leider nicht verarbeiten. Bitte versuchen Sie es erneut.'
    },
    it: {
      launcher: 'Scrivici in chat', openChat: 'Apri chat', closeChat: 'Chiudi chat', subtitle: 'Di solito risponde in pochi secondi',
      placeholder: 'Scrivi il tuo messaggio…', sendMessage: 'Invia messaggio', typing: "L'assistente sta scrivendo",
      note: 'Assistente IA. Il team potrebbe leggere questa chat per dare seguito alla tua richiesta.',
      greeting: 'Ciao! Posso rispondere a domande su {name}. Come posso aiutarti?',
      leadTitle: 'Dove possiamo risponderti?', leadIntro: 'Lascia i tuoi dati e ti ricontatteremo a breve.',
      name: 'Nome', email: 'Email', phone: 'Telefono / WhatsApp', contactHint: 'Email o telefono: ne basta uno.',
      message: 'Messaggio', service: 'Di cosa hai bisogno?', notSure: 'Non lo so ancora', notNow: 'Non ora', submit: 'Invia',
      contactRequired: 'Inserisci un indirizzo email o un numero di telefono.',
      thanks: 'Grazie! I tuoi dati sono stati inviati e il team ti contatterà a breve.',
      sendError: 'Impossibile inviare i tuoi dati. Riprova.',
      reachError: 'Impossibile raggiungere il server. Riprova tra un momento.',
      serverDown: 'Spiacente, non riesco a raggiungere il server. Lascia i tuoi dati e il team ti ricontatterà.',
      noReply: 'Spiacente, non sono riuscito a elaborare la richiesta. Riprova.'
    },
    pt: {
      launcher: 'Fale conosco', openChat: 'Abrir chat', closeChat: 'Fechar chat', subtitle: 'Costuma responder em segundos',
      placeholder: 'Digite sua mensagem…', sendMessage: 'Enviar mensagem', typing: 'O assistente está digitando',
      note: 'Assistente de IA. A equipe pode revisar esta conversa para dar continuidade ao seu pedido.',
      greeting: 'Olá! Posso responder a perguntas sobre {name}. Como posso ajudar?',
      leadTitle: 'Onde a equipe pode responder?', leadIntro: 'Deixe seus dados e alguém entrará em contato em breve.',
      name: 'Nome', email: 'E-mail', phone: 'Telefone / WhatsApp', contactHint: 'E-mail ou telefone: basta um.',
      message: 'Mensagem', service: 'Do que você precisa?', notSure: 'Ainda não sei', notNow: 'Agora não', submit: 'Enviar',
      contactRequired: 'Informe um e-mail ou um número de telefone.',
      thanks: 'Obrigado! Seus dados foram enviados e a equipe entrará em contato em breve.',
      sendError: 'Não foi possível enviar seus dados. Tente novamente.',
      reachError: 'Não foi possível conectar ao servidor. Tente novamente em instantes.',
      serverDown: 'Desculpe, não consegui conectar ao servidor. Deixe seus dados e a equipe entrará em contato.',
      noReply: 'Desculpe, não consegui processar isso. Tente novamente.'
    },
    ar: {
      launcher: 'تحدث معنا', openChat: 'فتح المحادثة', closeChat: 'إغلاق المحادثة', subtitle: 'يرد عادةً خلال ثوانٍ',
      placeholder: 'اكتب رسالتك…', sendMessage: 'إرسال الرسالة', typing: 'المساعد يكتب',
      note: 'مساعد بالذكاء الاصطناعي. قد يراجع الفريق هذه المحادثة لمتابعة استفسارك.',
      greeting: 'مرحبًا! يمكنني الإجابة عن أسئلتك حول {name}. كيف يمكنني مساعدتك؟',
      leadTitle: 'أين يمكن للفريق الرد عليك؟', leadIntro: 'اترك بياناتك وسيتواصل معك أحد أعضاء الفريق قريبًا.',
      name: 'الاسم', email: 'البريد الإلكتروني', phone: 'الهاتف / واتساب', contactHint: 'البريد الإلكتروني أو الهاتف، يكفي أحدهما.',
      message: 'الرسالة', service: 'ماذا تحتاج؟', notSure: 'لست متأكدًا بعد', notNow: 'ليس الآن', submit: 'إرسال',
      contactRequired: 'يرجى إدخال بريد إلكتروني أو رقم هاتف.',
      thanks: 'شكرًا! تم إرسال بياناتك وسيتواصل معك الفريق قريبًا.',
      sendError: 'تعذّر إرسال بياناتك. يرجى المحاولة مرة أخرى.',
      reachError: 'تعذّر الاتصال بالخادم. يرجى المحاولة بعد قليل.',
      serverDown: 'عذرًا، تعذّر الاتصال بالخادم. اترك بياناتك وسيتابع معك الفريق.',
      noReply: 'عذرًا، لم أتمكن من معالجة ذلك. يرجى المحاولة مرة أخرى.'
    },
    zh: {
      launcher: '在线咨询', openChat: '打开聊天', closeChat: '关闭聊天', subtitle: '通常几秒内回复',
      placeholder: '请输入您的消息…', sendMessage: '发送消息', typing: '助手正在输入',
      note: 'AI 助手。团队可能会查看此对话以跟进您的咨询。',
      greeting: '您好！我可以回答有关{name}的问题。有什么可以帮您？',
      leadTitle: '我们该如何回复您？', leadIntro: '留下您的联系方式，我们会尽快与您联系。',
      name: '姓名', email: '电子邮箱', phone: '电话 / WhatsApp', contactHint: '邮箱或电话，填写一项即可。',
      message: '留言', service: '您需要什么？', notSure: '还不确定', notNow: '暂不填写', submit: '提交',
      contactRequired: '请填写电子邮箱或电话号码。',
      thanks: '谢谢！您的信息已发送，团队会尽快与您联系。',
      sendError: '无法发送您的信息，请重试。',
      reachError: '无法连接服务器，请稍后再试。',
      serverDown: '抱歉，无法连接服务器。请留下您的联系方式，团队会与您联系。',
      noReply: '抱歉，无法处理您的消息，请重试。'
    },
    ja: {
      launcher: 'チャットで相談', openChat: 'チャットを開く', closeChat: 'チャットを閉じる', subtitle: '通常は数秒で返信します',
      placeholder: 'メッセージを入力…', sendMessage: 'メッセージを送信', typing: 'アシスタントが入力中',
      note: 'AIアシスタントです。お問い合わせへの対応のため、スタッフがこのチャットを確認する場合があります。',
      greeting: 'こんにちは！{name}についてのご質問にお答えします。どのようなご用件でしょうか？',
      leadTitle: 'ご連絡先を教えてください', leadIntro: 'ご連絡先をご記入いただければ、担当者からすぐにご連絡します。',
      name: 'お名前', email: 'メールアドレス', phone: '電話番号 / WhatsApp', contactHint: 'メールか電話番号のどちらか一方で結構です。',
      message: 'メッセージ', service: 'ご希望の内容', notSure: 'まだ決めていない', notNow: '今はしない', submit: '送信',
      contactRequired: 'メールアドレスまたは電話番号をご入力ください。',
      thanks: 'ありがとうございます！送信が完了しました。担当者よりご連絡いたします。',
      sendError: '送信できませんでした。もう一度お試しください。',
      reachError: 'サーバーに接続できません。しばらくしてからお試しください。',
      serverDown: '申し訳ありません。サーバーに接続できませんでした。ご連絡先を残していただければ、担当者からご連絡します。',
      noReply: '申し訳ありません。処理できませんでした。もう一度お試しください。'
    },
    ko: {
      launcher: '채팅 상담', openChat: '채팅 열기', closeChat: '채팅 닫기', subtitle: '보통 몇 초 안에 답변합니다',
      placeholder: '메시지를 입력하세요…', sendMessage: '메시지 보내기', typing: '어시스턴트가 입력 중입니다',
      note: 'AI 어시스턴트입니다. 문의 처리를 위해 담당자가 이 대화를 확인할 수 있습니다.',
      greeting: '안녕하세요! {name}에 대한 질문에 답변해 드립니다. 무엇을 도와드릴까요?',
      leadTitle: '어디로 연락드릴까요?', leadIntro: '연락처를 남겨 주시면 곧 연락드리겠습니다.',
      name: '이름', email: '이메일', phone: '전화번호 / WhatsApp', contactHint: '이메일 또는 전화번호 중 하나면 됩니다.',
      message: '메시지', service: '필요하신 것', notSure: '아직 모르겠어요', notNow: '나중에', submit: '보내기',
      contactRequired: '이메일 주소나 전화번호를 입력해 주세요.',
      thanks: '감사합니다! 정보가 전송되었으며 곧 연락드리겠습니다.',
      sendError: '정보를 보내지 못했습니다. 다시 시도해 주세요.',
      reachError: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      serverDown: '죄송합니다. 서버에 연결할 수 없습니다. 연락처를 남겨 주시면 담당자가 연락드리겠습니다.',
      noReply: '죄송합니다. 처리할 수 없었습니다. 다시 시도해 주세요.'
    },
    tr: {
      launcher: 'Bize yazın', openChat: 'Sohbeti aç', closeChat: 'Sohbeti kapat', subtitle: 'Genellikle saniyeler içinde yanıt verir',
      placeholder: 'Mesajınızı yazın…', sendMessage: 'Mesaj gönder', typing: 'Asistan yazıyor',
      note: 'Yapay zekâ asistanı. Talebinizi takip etmek için ekip bu sohbeti inceleyebilir.',
      greeting: 'Merhaba! {name} hakkındaki sorularınızı yanıtlayabilirim. Size nasıl yardımcı olabilirim?',
      leadTitle: 'Ekip size nereden ulaşsın?', leadIntro: 'Bilgilerinizi bırakın, kısa süre içinde size dönüş yapalım.',
      name: 'Ad Soyad', email: 'E-posta', phone: 'Telefon / WhatsApp', contactHint: 'E-posta veya telefon: biri yeterli.',
      message: 'Mesaj', service: 'Neye ihtiyacınız var?', notSure: 'Henüz emin değilim', notNow: 'Şimdi değil', submit: 'Gönder',
      contactRequired: 'Lütfen bir e-posta adresi veya telefon numarası girin.',
      thanks: 'Teşekkürler! Bilgileriniz gönderildi, ekip kısa süre içinde sizinle iletişime geçecek.',
      sendError: 'Bilgileriniz gönderilemedi. Lütfen tekrar deneyin.',
      reachError: 'Sunucuya ulaşılamadı. Lütfen biraz sonra tekrar deneyin.',
      serverDown: 'Üzgünüm, sunucuya ulaşamadım. Bilgilerinizi bırakın, ekip size dönüş yapsın.',
      noReply: 'Üzgünüm, bunu işleyemedim. Lütfen tekrar deneyin.'
    },
    ru: {
      launcher: 'Напишите нам', openChat: 'Открыть чат', closeChat: 'Закрыть чат', subtitle: 'Обычно отвечает за несколько секунд',
      placeholder: 'Введите сообщение…', sendMessage: 'Отправить сообщение', typing: 'Ассистент печатает',
      note: 'ИИ-ассистент. Команда может просмотреть этот чат, чтобы ответить на ваш запрос.',
      greeting: 'Здравствуйте! Я отвечу на вопросы о {name}. Чем могу помочь?',
      leadTitle: 'Как с вами связаться?', leadIntro: 'Оставьте свои контакты, и мы скоро свяжемся с вами.',
      name: 'Имя', email: 'Эл. почта', phone: 'Телефон / WhatsApp', contactHint: 'Эл. почта или телефон — достаточно одного.',
      message: 'Сообщение', service: 'Что вам нужно?', notSure: 'Пока не знаю', notNow: 'Не сейчас', submit: 'Отправить',
      contactRequired: 'Укажите адрес эл. почты или номер телефона.',
      thanks: 'Спасибо! Ваши данные отправлены, команда скоро свяжется с вами.',
      sendError: 'Не удалось отправить данные. Попробуйте ещё раз.',
      reachError: 'Не удалось подключиться к серверу. Попробуйте чуть позже.',
      serverDown: 'Извините, не удалось подключиться к серверу. Оставьте контакты, и команда свяжется с вами.',
      noReply: 'Извините, не удалось обработать сообщение. Попробуйте ещё раз.'
    }
  };

  function baseLanguage(code) {
    return String(code || '').toLowerCase().split(/[-_]/)[0];
  }
  function supportedLanguage(code) {
    var base = baseLanguage(code);
    return I18N[base] ? base : null;
  }

  var state = {
    conversationId: readStorage(),
    leadSubmitted: false,
    messagesSinceDismiss: Infinity,
    sending: false,
    lang: supportedLanguage(script.getAttribute('data-language')) || supportedLanguage(navigator.language) || 'en',
    config: { name: '', brand_color: DEFAULT_COLOR, services: [], lead_fields: [] }
  };

  function t(key) {
    var text = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || '';
    return text.replace('{name}', state.config.name || 'us');
  }

  // ---- Storage (per tab; can be unavailable in private mode) ----
  function readStorage() {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }
  function writeStorage(value) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      /* ignore */
    }
  }

  // ---- Colours ----
  function safeColor(value) {
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value || '') ? value : DEFAULT_COLOR;
  }
  // White or near-black text, whichever reads better on the brand colour.
  function textOn(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var rgb = [0, 2, 4].map(function (i) {
      var c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    var luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return luminance > 0.45 ? '#111827' : '#ffffff';
  }

  // ---- Markup ----
  var STYLES = [
    ':host { all: initial; }',
    '*, *::before, *::after { box-sizing: border-box; }',
    '.root { position: fixed; bottom: 20px; ' + POSITION + ': 20px; z-index: 2147483000;',
    '  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Arabic", sans-serif; font-size: 15px; line-height: 1.45; color: #111827; }',
    '.launcher { display: flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; padding: 12px 18px;',
    '  background: var(--brand); color: var(--on-brand); font-family: inherit; font-size: 15px; font-weight: 600; line-height: 1; cursor: pointer;',
    '  box-shadow: 0 6px 24px rgba(0,0,0,.18); }',
    '.launcher:hover { filter: brightness(1.05); }',
    '.launcher:focus-visible, button:focus-visible, textarea:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }',
    '.launcher svg { width: 20px; height: 20px; }',
    '.panel { position: absolute; bottom: 64px; ' + POSITION + ': 0; width: 370px; height: min(580px, calc(100vh - 110px));',
    '  display: flex; flex-direction: column; background: #fff; border-radius: 16px; overflow: hidden;',
    '  box-shadow: 0 12px 48px rgba(0,0,0,.22); }',
    '.panel[hidden] { display: none; }',
    'header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px;',
    '  background: var(--brand); color: var(--on-brand); }',
    'header strong { display: block; font-size: 16px; }',
    'header small { display: block; font-size: 12.5px; opacity: .85; }',
    '.icon-btn { border: 0; background: transparent; color: inherit; font-size: 24px; line-height: 1; padding: 4px 8px; cursor: pointer; border-radius: 8px; }',
    '.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #f7f7f8; }',
    '.msg { max-width: 85%; padding: 10px 13px; border-radius: 14px; white-space: pre-wrap; word-wrap: break-word; }',
    '.msg.assistant { align-self: flex-start; background: #fff; border: 1px solid #e5e7eb; border-end-start-radius: 4px; }',
    '.msg.user { align-self: flex-end; background: var(--brand); color: var(--on-brand); border-end-end-radius: 4px; }',
    '.typing { display: inline-flex; gap: 4px; padding: 14px 13px; }',
    '.typing span { width: 6px; height: 6px; border-radius: 50%; background: #9ca3af; animation: blink 1.2s infinite; }',
    '.typing span:nth-child(2) { animation-delay: .2s; } .typing span:nth-child(3) { animation-delay: .4s; }',
    '@keyframes blink { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }',
    'form.composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e7eb; background: #fff; }',
    'textarea, input, select { font: inherit; font-size: 15px; color: #111827; border: 1px solid #d1d5db; border-radius: 10px; padding: 9px 11px; background: #fff; width: 100%; }',
    'form.composer textarea { flex: 1; resize: none; max-height: 110px; }',
    '.send { flex: none; border: 0; border-radius: 10px; width: 44px; background: var(--brand); color: var(--on-brand); font-size: 18px; cursor: pointer; }',
    '.send:disabled { opacity: .5; cursor: default; }',
    '.note { margin: 0; padding: 0 12px 10px; font-size: 11.5px; color: #6b7280; background: #fff; }',
    '.lead { position: absolute; inset: 0; background: rgba(17,24,39,.45); display: flex; align-items: flex-end; }',
    '.lead[hidden] { display: none; }',
    '.lead-card { width: 100%; background: #fff; border-radius: 16px 16px 0 0; padding: 18px 16px; max-height: 100%; overflow-y: auto; }',
    '.lead-card h2 { margin: 0 0 4px; font-size: 17px; }',
    '.lead-card p { margin: 0 0 12px; font-size: 13.5px; color: #4b5563; }',
    '.lead-card form { display: flex; flex-direction: column; gap: 10px; }',
    '.lead-card label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; color: #374151; }',
    '.lead-card .hint { margin: -4px 0 0; font-size: 12px; color: #6b7280; }',
    '.lead-card label[hidden] { display: none; }',
    '.lead-actions { display: flex; gap: 8px; margin-top: 4px; }',
    '.primary { flex: 1; border: 0; border-radius: 10px; padding: 11px; background: var(--brand); color: var(--on-brand); font: inherit; font-weight: 600; cursor: pointer; }',
    '.secondary { border: 1px solid #d1d5db; border-radius: 10px; padding: 11px 14px; background: #fff; color: #374151; font: inherit; cursor: pointer; }',
    '.error { color: #b91c1c; font-size: 13px; min-height: 1em; margin: 0; }',
    '@media (max-width: 480px) {',
    '  .root { bottom: 12px; ' + POSITION + ': 12px; }',
    '  .panel { position: fixed; inset: 0; width: auto; height: auto; border-radius: 0; }',
    '  .root.open .launcher { display: none; }',
    '}'
  ].join('\n');

  var CHAT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  // Static markup only. All interface text is filled in by applyLanguage()
  // (data-t = text, data-t-placeholder / data-t-aria = attributes), and every
  // piece of business or visitor text is set with textContent, never as HTML.
  var MARKUP =
    '<div class="root">' +
    '  <section class="panel" role="dialog" hidden>' +
    '    <header><div><strong class="title"></strong><small data-t="subtitle"></small></div>' +
    '      <button class="icon-btn close" type="button" data-t-aria="closeChat">&times;</button></header>' +
    '    <div class="messages" aria-live="polite"></div>' +
    '    <form class="composer">' +
    '      <textarea rows="1" maxlength="2000" data-t-placeholder="placeholder" data-t-aria="placeholder"></textarea>' +
    '      <button class="send" type="submit" data-t-aria="sendMessage">&uarr;</button>' +
    '    </form>' +
    '    <p class="note" data-t="note"></p>' +
    '    <div class="lead" hidden>' +
    '      <div class="lead-card" role="dialog" data-t-aria="leadTitle">' +
    '        <h2 data-t="leadTitle"></h2>' +
    '        <p data-t="leadIntro"></p>' +
    '        <form class="lead-form" novalidate>' +
    '          <label><span data-t="name"></span><input name="name" autocomplete="name" required maxlength="120"></label>' +
    '          <label><span data-t="email"></span><input name="email" type="email" autocomplete="email" maxlength="200"></label>' +
    '          <label><span data-t="phone"></span><input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>' +
    '          <p class="hint" data-t="contactHint"></p>' +
    '          <div class="custom-fields"></div>' +
    '          <label class="service-field" hidden><span data-t="service"></span><select name="service"><option value="" data-t="notSure"></option></select></label>' +
    '          <label><span data-t="message"></span><textarea name="need" rows="3" maxlength="2000"></textarea></label>' +
    '          <p class="error lead-error" role="alert"></p>' +
    '          <div class="lead-actions"><button class="secondary not-now" type="button" data-t="notNow"></button>' +
    '            <button class="primary" type="submit" data-t="submit"></button></div>' +
    '        </form>' +
    '      </div>' +
    '    </div>' +
    '  </section>' +
    '  <button class="launcher" type="button" data-t-aria="openChat">' + CHAT_ICON + '<span class="launcher-label"></span></button>' +
    '</div>';

  var host = document.createElement('div');
  host.setAttribute('data-ai-lead-assistant', business);
  var shadow = host.attachShadow({ mode: 'open' });
  var style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);
  var wrapper = document.createElement('div');
  wrapper.innerHTML = MARKUP;
  shadow.appendChild(wrapper.firstChild);

  function $(selector) {
    return shadow.querySelector(selector);
  }
  function $all(selector) {
    return Array.prototype.slice.call(shadow.querySelectorAll(selector));
  }
  var root = $('.root');
  var panel = $('.panel');
  var launcher = $('.launcher');
  var messages = $('.messages');
  var composer = $('form.composer');
  var input = $('form.composer textarea');
  var sendButton = $('.send');
  var lead = $('.lead');
  var leadForm = $('.lead-form');
  var leadError = $('.lead-error');
  var customFields = $('.custom-fields');

  // ---- Language ----
  function applyLanguage() {
    $all('[data-t]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-t'));
    });
    $all('[data-t-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-t-placeholder')));
    });
    $all('[data-t-aria]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-t-aria')));
    });
    $('.launcher-label').textContent = script.getAttribute('data-label') || t('launcher');
    panel.setAttribute('aria-label', state.config.name || t('launcher'));
    panel.setAttribute('lang', state.lang);
    panel.setAttribute('dir', RTL_LANGUAGES.indexOf(state.lang) === -1 ? 'ltr' : 'rtl');
    renderCustomFields();
  }

  // Follow the language the visitor writes in (as detected by the server).
  function setLanguage(code) {
    var base = baseLanguage(code);
    if (!base || base === state.lang) return;
    // Unsupported languages fall back to English interface text; the
    // assistant's replies are still in the visitor's language.
    var next = I18N[base] ? base : 'en';
    if (next === state.lang) return;
    state.lang = next;
    applyLanguage();
  }

  // ---- Branding and the business's own lead questions ----
  function leadFieldsConfig() {
    var fields = Array.isArray(state.config.lead_fields) ? state.config.lead_fields : [];
    return fields.filter(function (f) {
      return f && typeof f.key === 'string' && /^[a-z0-9_-]{1,40}$/i.test(f.key);
    });
  }

  function fieldLabel(field) {
    var label = field.label;
    if (typeof label === 'string') return label;
    if (label && typeof label === 'object') {
      return label[state.lang] || label.en || label[Object.keys(label)[0]] || field.key;
    }
    return field.key;
  }

  // Rebuilds the business's questions (e.g. course, start date) in the
  // current language, keeping anything the visitor already filled in.
  function renderCustomFields() {
    var previous = {};
    $all('.custom-fields [name^="detail:"]').forEach(function (el) {
      previous[el.name] = el.value;
    });
    customFields.textContent = '';

    var fields = leadFieldsConfig();
    fields.forEach(function (field) {
      var label = document.createElement('label');
      var caption = document.createElement('span');
      caption.textContent = fieldLabel(field);
      label.appendChild(caption);

      var control;
      if (field.type === 'select' && Array.isArray(field.options)) {
        control = document.createElement('select');
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '—';
        control.appendChild(empty);
        field.options.forEach(function (value) {
          var option = document.createElement('option');
          option.value = String(value);
          option.textContent = String(value);
          control.appendChild(option);
        });
      } else {
        control = document.createElement('input');
        control.type = 'text';
        control.maxLength = 200;
      }
      control.name = 'detail:' + field.key;
      if (previous[control.name]) control.value = previous[control.name];
      label.appendChild(control);
      customFields.appendChild(label);
    });
    customFields.style.display = fields.length ? 'contents' : 'none';
    // A business with its own questions doesn't need the generic services list.
    leadForm.querySelector('.service-field').hidden =
      fields.length > 0 || !(Array.isArray(state.config.services) && state.config.services.length);
  }

  function applyBranding() {
    var color = safeColor(state.config.brand_color);
    root.style.setProperty('--brand', color);
    root.style.setProperty('--on-brand', textOn(color));
    $('.title').textContent = state.config.name || '';

    var services = Array.isArray(state.config.services) ? state.config.services : [];
    var select = leadForm.querySelector('select[name="service"]');
    while (select.options.length > 1) select.remove(1);
    services.forEach(function (service) {
      var option = document.createElement('option');
      option.value = service;
      option.textContent = service;
      select.appendChild(option);
    });
    applyLanguage();
  }

  // ---- Messages ----
  function addMessage(text, role) {
    var el = document.createElement('div');
    el.className = 'msg ' + role;
    el.setAttribute('dir', 'auto');
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  function showTyping() {
    var el = document.createElement('div');
    el.className = 'msg assistant typing';
    el.setAttribute('aria-label', t('typing'));
    el.innerHTML = '<span></span><span></span><span></span>';
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  var greeted = false;
  function openPanel() {
    panel.hidden = false;
    root.classList.add('open');
    launcher.setAttribute('aria-expanded', 'true');
    if (!greeted) {
      greeted = true;
      addMessage(script.getAttribute('data-greeting') || t('greeting'), 'assistant');
    }
    input.focus();
  }
  function closePanel() {
    panel.hidden = true;
    root.classList.remove('open');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  // ---- Lead form ----
  function maybeOfferLeadForm(context) {
    if (state.leadSubmitted || state.messagesSinceDismiss < MESSAGES_BEFORE_REOFFER) return;
    setTimeout(function () {
      leadForm.querySelector('[name="need"]').value = context || '';
      leadError.textContent = '';
      lead.hidden = false;
      leadForm.querySelector('[name="name"]').focus();
    }, 450);
  }
  function closeLeadForm() {
    lead.hidden = true;
    state.messagesSinceDismiss = 0;
    input.focus();
  }

  // ---- API ----
  function api(path, options) {
    return fetch(API_BASE + path, options).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
    });
  }

  function send(text) {
    if (state.sending) return;
    state.sending = true;
    sendButton.disabled = true;
    state.messagesSinceDismiss += 1;
    addMessage(text, 'user');
    var typing = showTyping();

    api('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, conversationId: state.conversationId, business: business })
    })
      .then(function (result) {
        typing.remove();
        var data = result.data || {};
        if (data.conversationId) {
          state.conversationId = data.conversationId;
          writeStorage(data.conversationId);
        }
        if (data.language) setLanguage(data.language);
        addMessage(data.answer || data.error || t('noReply'), 'assistant');
        // Pre-fill the form with the visitor's own words (the AI's summary is
        // written for staff, about the visitor, so it reads oddly to them).
        if (data.suggestLeadCapture) maybeOfferLeadForm(text);
      })
      .catch(function () {
        typing.remove();
        addMessage(t('serverDown'), 'assistant');
        maybeOfferLeadForm(text);
      })
      .then(function () {
        state.sending = false;
        sendButton.disabled = false;
      });
  }

  // ---- Events ----
  launcher.addEventListener('click', function () {
    if (panel.hidden) openPanel();
    else closePanel();
  });
  $('.close').addEventListener('click', closePanel);
  root.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (!lead.hidden) closeLeadForm();
    else if (!panel.hidden) closePanel();
  });

  composer.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = '';
    send(text);
  });
  input.addEventListener('keydown', function (event) {
    // Enter sends; Shift+Enter adds a new line.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      composer.requestSubmit ? composer.requestSubmit() : composer.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
  });

  $('.not-now').addEventListener('click', closeLeadForm);
  leadForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var form = new FormData(leadForm);
    var name = String(form.get('name') || '').trim();
    var email = String(form.get('email') || '').trim();
    var phone = String(form.get('phone') || '').trim();
    leadError.textContent = '';

    if (!name) {
      leadForm.querySelector('[name="name"]').focus();
      return;
    }
    if (!email && !phone) {
      leadError.textContent = t('contactRequired');
      leadForm.querySelector('[name="email"]').focus();
      return;
    }

    var details = {};
    $all('.custom-fields [name^="detail:"]').forEach(function (el) {
      if (el.value.trim()) details[el.name.slice('detail:'.length)] = el.value.trim();
    });

    var submit = leadForm.querySelector('.primary');
    submit.disabled = true;
    api('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        email: email || null,
        phone: phone || null,
        serviceNeeded: form.get('service') || null,
        message: form.get('need'),
        details: details,
        conversationId: state.conversationId,
        business: business
      })
    })
      .then(function (result) {
        if (!result.ok) {
          leadError.textContent = (result.data && result.data.error) || t('sendError');
          return;
        }
        state.leadSubmitted = true;
        leadForm.reset();
        lead.hidden = true;
        addMessage(t('thanks'), 'assistant');
      })
      .catch(function () {
        leadError.textContent = t('reachError');
      })
      .then(function () {
        submit.disabled = false;
      });
  });

  // ---- Start ----
  function mount() {
    document.body.appendChild(host);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  applyBranding();
  api('/api/config?business=' + encodeURIComponent(business))
    .then(function (result) {
      if (result.status === 403) {
        console.warn('[AI assistant widget] This website is not in the allowed list for "' + business + '".');
        host.remove();
        return;
      }
      if (!result.ok) {
        console.warn('[AI assistant widget] Unknown business "' + business + '".');
        return;
      }
      state.config = result.data;
      applyBranding();
    })
    .catch(function () {
      /* keep defaults; the chat itself will report connection problems */
    });
})();
