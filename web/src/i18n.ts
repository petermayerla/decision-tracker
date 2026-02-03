// Simple i18n dictionary for EN/DE language support

export type Language = 'en' | 'de';

const translations = {
  en: {
    // Language switcher
    'lang.en': 'EN',
    'lang.de': 'DE',

    // Buttons
    'button.start': 'Start',
    'button.done': 'Done',
    'button.add': 'Add',
    'button.generate': 'Generate',
    'button.suggest': 'Suggest',
    'button.save': 'Save',
    'button.skip': 'Skip',
    'button.continue': 'Continue',
    'button.finish': 'Finish',
    'button.cancel': 'Cancel',
    'button.delete': 'Delete',
    'button.edit': 'Edit',
    'button.refine': 'Refine',
    'button.quickPick': 'Quick pick',
    'button.typeInstead': 'Type instead',
    'button.letsDoIt': "Let's do it",

    // Goal wizard
    'wizard.step1.title': 'Name your goal',
    'wizard.step1.subtitle': 'What do you want to accomplish?',
    'wizard.step1.placeholder': 'e.g., Improve team communication',
    'wizard.step2.title': 'Add clarity',
    'wizard.step2.subtitle': 'Define what success looks like to stay focused and measure progress.',
    'wizard.step2.outcome.label': 'What does success look like?',
    'wizard.step2.outcome.placeholder': 'e.g., All team members feel heard in meetings',
    'wizard.step2.outcome.hint': 'Describe the desired end state',
    'wizard.step2.metric.label': 'How will you measure it?',
    'wizard.step2.metric.placeholder': 'e.g., Weekly satisfaction score',
    'wizard.step2.metric.hint': "What number tells you it's working?",
    'wizard.step2.horizon.label': 'By when?',
    'wizard.step2.horizon.placeholder': 'e.g., End of Q1',
    'wizard.step2.horizon.hint': 'Set a realistic timeline',

    // Empty states
    'empty.noGoals': 'No goals yet',
    'empty.addFirstGoal': 'Add your first goal to get started',

    // Morning briefing
    'briefing.title': 'Daily Briefing',
    'briefing.prompt': 'Get your personalized focus for today',
    'briefing.generate': 'Generate briefing',
    'briefing.loading': 'Loading…',
    'briefing.committed': 'Committed for today',

    // Reflection
    'reflection.title': 'Quick Reflection',
    'reflection.save': 'Save',
    'reflection.skip': 'Skip',
    'reflection.note.placeholder': 'What worked? What didn\'t?',

    // Status
    'status.todo': 'To Do',
    'status.inProgress': 'In Progress',
    'status.done': 'Done',

    // Headers
    'header.goals': 'Goals',
    'header.actions': 'Actions',

    // New goal button
    'newGoal.button': '+ New Goal',
  },
  de: {
    // Language switcher
    'lang.en': 'EN',
    'lang.de': 'DE',

    // Buttons
    'button.start': 'Starten',
    'button.done': 'Fertig',
    'button.add': 'Hinzufügen',
    'button.generate': 'Generieren',
    'button.suggest': 'Vorschlag',
    'button.save': 'Speichern',
    'button.skip': 'Überspringen',
    'button.continue': 'Weiter',
    'button.finish': 'Abschließen',
    'button.cancel': 'Abbrechen',
    'button.delete': 'Löschen',
    'button.edit': 'Bearbeiten',
    'button.refine': 'Verfeinern',
    'button.quickPick': 'Schnellwahl',
    'button.typeInstead': 'Stattdessen eingeben',
    'button.letsDoIt': 'Los geht\'s',

    // Goal wizard
    'wizard.step1.title': 'Ziel benennen',
    'wizard.step1.subtitle': 'Was möchten Sie erreichen?',
    'wizard.step1.placeholder': 'z.B. Teamkommunikation verbessern',
    'wizard.step2.title': 'Klarheit schaffen',
    'wizard.step2.subtitle': 'Definieren Sie, wie Erfolg aussieht, um fokussiert zu bleiben und Fortschritte zu messen.',
    'wizard.step2.outcome.label': 'Wie sieht Erfolg aus?',
    'wizard.step2.outcome.placeholder': 'z.B. Alle Teammitglieder fühlen sich in Meetings gehört',
    'wizard.step2.outcome.hint': 'Beschreiben Sie den gewünschten Endzustand',
    'wizard.step2.metric.label': 'Wie werden Sie es messen?',
    'wizard.step2.metric.placeholder': 'z.B. Wöchentlicher Zufriedenheitswert',
    'wizard.step2.metric.hint': 'Welche Zahl zeigt, dass es funktioniert?',
    'wizard.step2.horizon.label': 'Bis wann?',
    'wizard.step2.horizon.placeholder': 'z.B. Ende Q1',
    'wizard.step2.horizon.hint': 'Setzen Sie einen realistischen Zeitrahmen',

    // Empty states
    'empty.noGoals': 'Noch keine Ziele',
    'empty.addFirstGoal': 'Fügen Sie Ihr erstes Ziel hinzu, um zu beginnen',

    // Morning briefing
    'briefing.title': 'Tagesbriefing',
    'briefing.prompt': 'Holen Sie sich Ihren personalisierten Fokus für heute',
    'briefing.generate': 'Briefing generieren',
    'briefing.loading': 'Lädt…',
    'briefing.committed': 'Für heute zugesagt',

    // Reflection
    'reflection.title': 'Kurze Reflexion',
    'reflection.save': 'Speichern',
    'reflection.skip': 'Überspringen',
    'reflection.note.placeholder': 'Was hat funktioniert? Was nicht?',

    // Status
    'status.todo': 'Offen',
    'status.inProgress': 'In Arbeit',
    'status.done': 'Erledigt',

    // Headers
    'header.goals': 'Ziele',
    'header.actions': 'Aktionen',

    // New goal button
    'newGoal.button': '+ Neues Ziel',
  },
} as const;

const LS_LANG_KEY = 'dt_lang';

export function detectLanguage(): Language {
  // Check localStorage first
  const stored = localStorage.getItem(LS_LANG_KEY);
  if (stored === 'en' || stored === 'de') {
    return stored;
  }

  // Detect browser language
  const browserLang = navigator.language.toLowerCase();
  if (browserLang.startsWith('de')) {
    return 'de';
  }

  return 'en';
}

export function saveLanguage(lang: Language): void {
  localStorage.setItem(LS_LANG_KEY, lang);
}

export function t(key: keyof typeof translations.en, lang: Language = 'en'): string {
  return translations[lang][key] || translations.en[key] || key;
}
