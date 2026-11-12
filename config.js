// Verbindung zu deinem Supabase-Projekt.
// Der "publishable" Key darf öffentlich sein: Die Daten schützt die Datenbank selbst (Row Level Security).
export const SUPABASE_URL = 'https://hzcoihkshmbfgcizrlug.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_x4sx6AlrL3nDhXQSnzFBhA_nAnkBMyq';

// Öffentliche Adresse der App. Steht in der Einladungs-Mail.
export const APP_URL = 'https://bz5ygkpydb-crypto.github.io/Planer/';

// Registrierung neuer Konten. Die Datenbank lässt nur E-Mail-Adressen zu, die der Inhaber
// in den Einstellungen eingeladen hat (siehe supabase/schema.sql, Abschnitt "Einladungen").
export const ALLOW_SIGNUP = true;

// Einmalige Umbenennungen von Kategorien: alter Name -> neuer Name. Die App führt sie beim nächsten
// Start automatisch aus (Buchungen und feste Posten eingeschlossen) und merkt sich den alten Namen,
// damit der Apple-Pay-Kurzbefehl weiter funktioniert.
export const CATEGORY_RENAMES = { Klamo: 'Kleidung' };

// Standard-Kategorien für Ausgaben. In der App unter "Einstellungen" änderbar.
export const DEFAULT_CATEGORIES = [
  'Supermarkt',
  'Getränke',
  'Restaurant & Café',
  'Kleidung',
  'Shopping',
  'Technik',
  'Haushalt & Möbel',
  'Körperpflege',
  'Gesundheit',
  'Transport & Reise',
  'Wohnen',
  'Versicherung',
  'Abo',
  'Bildung',
  'Freizeit & Unterhaltung',
  'Geschenke',
  'Sparen & Investieren',
  'Sonstiges',
];

// Kategorien für Einnahmen.
export const DEFAULT_INCOME_CATEGORIES = ['Gehalt', 'Nebenjob', 'Kindergeld', 'Zinsen & Dividenden', 'Erstattung', 'Geschenk', 'Sonstige Einnahmen'];
