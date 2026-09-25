/**
 * config.js — the settings you are most likely to want to change.
 *
 * Everything here is plain data. Editing these values changes how the planner
 * behaves; no other file needs to be touched.
 */

/**
 * Which subjects to study on which weekday, taken from the Klasse 8 timetable.
 * Keys are JavaScript weekday numbers (0 = Sunday ... 6 = Saturday), so only
 * Monday-Friday are listed and weekends fall through to catch-up picks.
 *
 * A name here must match a catalog's `subject` exactly, which is the first word
 * of the catalog's sheet name ("Mathematik Klasse 8" -> "Mathematik"). Subjects
 * from the timetable that have no catalog (Eng, ICT, Ku ...) are left out.
 */
const SCHEDULE = {
  1: ["Physik", "Deutsch", "Französisch"],   // Mon: Ph, Eng, Deu/DaF, Frz
  2: ["Mathematik"],                         // Tue: Ma, Eng, ICT, Ku
  3: ["Biologie", "Französisch", "Deutsch"], // Wed: Bio, Frz, LZ, SPS, Deu/DaF
  4: ["Mathematik", "Geschichte"],           // Thu: Ma, Ge, LZ, Vie, Pro
  5: ["Geographie", "Chemie", "Deutsch"],    // Fri: KL, Et, Geo, Deu/DaF, Ch
};

/**
 * How many videos to assign per day. When a weekday's SCHEDULE entry names
 * fewer subjects than this, the remaining slots are filled with whichever
 * subjects are least far ahead of the class (see curriculum.js).
 */
const VIDEOS_PER_DAY = 3;

/**
 * The most extra videos a day can get to catch up with the class. While a
 * subject would still be behind the class after today's videos, one more of
 * its videos is added, most-behind subject first, until every subject is ahead
 * or this many have been added. Set it to 0 to never add any.
 */
const MAX_CATCH_UP_VIDEOS = 3;

/**
 * How many videos to assign on a day off (see DAYS_OFF): three times the usual
 * amount, to get ahead of the class while there are no lessons.
 */
const VIDEOS_PER_DAY_OFF = VIDEOS_PER_DAY * 3;

/**
 * Days without lessons, from the IGS School Calendar 2026/27. These days get
 * VIDEOS_PER_DAY_OFF videos and ignore the timetable.
 *
 * Each entry runs from `from` to `to`, both included; a single day only needs
 * `from`. A break's dates include the weekends at either end, since they're
 * part of it. Ordinary weekends aren't listed and keep VIDEOS_PER_DAY, and so
 * is a holiday that falls on a weekend anyway (Day of German Unity, Sat 3 Oct),
 * since it doesn't free up a school day.
 *
 * Add the 2027/28 dates here once that calendar comes out.
 */
const DAYS_OFF = [
  { from: "2026-08-01", to: "2026-09-06", name: "Summer holidays" },   // incl. National Day 1–2 Sep
  { from: "2026-10-10", to: "2026-10-20", name: "Autumn holidays" },   // incl. conferences 19–20 Oct
  { from: "2026-11-24",                   name: "Vietnamese Culture Day" },
  { from: "2026-12-12", to: "2027-01-03", name: "Christmas holidays" },
  { from: "2027-01-30", to: "2027-02-14", name: "TET holidays" },
  { from: "2027-03-26", to: "2027-03-31", name: "Easter" },            // Good Friday to conferences 30–31 Mar
  { from: "2027-04-16",                   name: "Hùng Kings' Festival" },
  { from: "2027-04-24", to: "2027-05-03", name: "Spring holidays" },   // incl. 30 Apr and 1 May
  { from: "2027-07-15", to: "2027-09-05", name: "Summer holidays" },   // 2027/28 starts Mon 6 Sep
];

/**
 * The first and last day of lessons in the school year, from the IGS School
 * Calendar 2026/27. Where the class is in the curriculum is estimated from how
 * many of the year's business days (weekdays, skipping DAYS_OFF) have passed
 * (see curriculum.js).
 */
const SCHOOL_YEAR = { from: "2026-09-07", to: "2027-07-14" };

/**
 * The Klasse 8 curriculum, from "Themenübersicht - Klasse 8", in the order its
 * topics are listed there, which is taken to be the order they're taught.
 *
 * Each topic names the sofatutor videos that cover it, in either of two ways:
 *
 *   sections  headings in the catalog spreadsheet (the light blue rows); every
 *             video under that heading belongs to the topic
 *   videos    exact video titles, for when only part of a section fits
 *
 * A title listed under `videos` belongs to that topic even if one of its
 * sections is also listed under an earlier topic. Videos are studied topic by
 * topic in this order; videos in no topic come after all of them.
 *
 * A heading or title that doesn't match anything is reported in the browser's
 * console (F12), so a typo doesn't silently leave videos out.
 *
 * Subjects left out here (and uploaded catalogs) are studied in spreadsheet
 * order and paced to finish by the end of the school year. Curriculum topics
 * with no matching sofatutor video have an empty list.
 */
const CURRICULUM = {
  Biologie: [
    { topic: "Körper und Gesundheit", sections: [
      "Zusammenwirken der Organe, Muskulatur und Gesunderhaltung des Körpers",
      "Aufbau und Funktion des Immunsystems",
      "Krankheiten und Krankheitserreger",
    ] },
    { topic: "Bewegung", videos: [
      "Gesunderhaltung des Körpers – ich bleibe fit!",
      "Muskeln und Energie – Es war einmal das Leben (Folge 24)",
    ] },
    { topic: "Atmung", sections: [
      "Bau und Funktion der Atmungsorgane",
      "Gefahren für die Lunge",
    ] },
    { topic: "Herz", sections: [
      "Blutgruppen und Funktion des Blutes",
      "Blutkreislauf, Herz und Blutgefäße",
    ] },
    { topic: "Ernährung", sections: ["Nahrung und gesunde Ernährung"] },
    { topic: "Stoffwechsel", sections: ["Verdauung und Energiegewinnung"] },
    { topic: "Pubertät", sections: [
      "Geschlechtsmerkmale",
      "Befruchtung, Schwangerschaft, Geburt und Entwicklung",
      "Pubertät – eine Zeit der Veränderungen",
      "Empfängnisverhütung und Schutz vor sexuell übertragbaren Krankheiten",
    ] },
  ],

  Chemie: [
    { topic: "Periodensystem", sections: [
      "Einteilung der Elemente im Periodensystem",
      "Ordnungsprinzipien, Elektronenstruktur, Schalen und Wertigkeit",
      "Atombau und Atommodelle",
      "Wasserstoff und I., II. und III. Hauptgruppe",
      "Kohlenstoff und die IV. Hauptgruppe",
      "Phosphor, Stickstoff und die V. Hauptgruppe",
      "Sauerstoff, Schwefel und die VI. Hauptgruppe",
      "Fluor, Chlor und die Halogene der VII. Hauptgruppe",
      "Helium, Neon und die Edelgase der VIII. Hauptgruppe",
    ] },
    { topic: "Atommasse",
      sections: ["Stöchiometrische Berechnungen – Stoffmenge, molare Masse und Konzentration"],
      videos: ["Das Gesetz von der Erhaltung der Masse"] },
    { topic: "Reduktion / Oxidation", sections: [
      "Oxidation, Reduktion und Redoxreaktion",
      "Elektrolyse, Korrosion und Desinfektion als Redoxreaktionen",
    ] },
    { topic: "Hochofenprozesse",
      sections: ["Metallgewinnung und Thermitverfahren"],
      videos: ["Eisen", "Eisenherstellung"] },
    { topic: "Legierung", videos: [
      "Eigenschaften von Metallen",
      "Metallbindung",
      "Legierungen (Expertenwissen)",
      "Verwendung von Metallen",
    ] },
    { topic: "Salze", sections: [
      "Salze und Ionenbindung",
      "Wichtige Gruppen von Salzen",
    ] },
  ],

  Deutsch: [
    { topic: "Berichte und Reportagen", sections: ["Berichte schreiben"] },
    { topic: "Lineare und nicht lineare Texte, Sachtexte", sections: [
      "Sachtexte: Arten, Merkmale und Analyse",
      "Texte lesen, verstehen und organisieren",
    ] },
    { topic: "Lyrik", sections: [
      "Gedichte: Arten, Merkmale, Analyse und Interpretation",
      "Sprachliche Bilder und Stilmittel",
    ] },
    { topic: "Jugendbuch", sections: ["Erzähltexte: Arten, Merkmale und Interpretation"] },
    { topic: "Rechtschreibung und Grammatik", sections: [
      "Satzglieder und Satzarten unterscheiden",
      "Artikel, Nomen und die vier Fälle",
      "Verben und Zeitformen",
      "Adjektive und Adverbien",
      "Pronomen",
      "Konjunktionen, Präpositionen, Numeralien und Interjektionen",
      "Wortarten im Überblick",
      "Aktiv, Passiv, Konjunktiv und indirekte Rede",
      "Wortbildung, Wortbedeutung und Sprichwörter",
      "Rechtschreibung üben: Tipps und Regeln",
      "Zeichensetzung üben: Kommas und andere Satzzeichen",
      "Schreibung von Wörtern: getrennt, zusammen, groß oder klein?",
    ] },
  ],

  Französisch: [
    { topic: "U1 Voyages dans les pays francophones", sections: [
      "Reisen, Länder und Wetter",
      "Sprache und Geographie",
    ] },
    { topic: "U2 Occupations et professions", videos: [
      "Familie und Berufe – la famille et les professions",
      "Berufe – les professions",
      "Einen Lebenslauf verfassen – écrire un CV",
      "Bewerbungsschreiben verfassen – écrire une lettre de candidature (1)",
      "Bewerbungsschreiben verfassen – écrire une lettre de candidature (2)",
    ] },
    { topic: "U3 Apparences et personnalité", sections: [
      "Farben, Kleidung und Körper",
      "Adjektive und Adverbien",
    ] },
    { topic: "U4 Nourriture et bien-être", videos: [
      "Französisches Frühstück – le petit-déjeuner",
      "Mengenangaben mit „de\" auf Französisch",
      "Mengenangaben mit „de\" auf Französisch – Übungen",
      "Manger – Konjugation",
      "Faire les courses – Hörverständnis",
      "À la cantine – Hörverständnis",
      "Nach dem Befinden fragen",
      "Arzttermine vereinbaren",
      "Beim Arzt",
    ] },
  ],

  Geographie: [
    { topic: "Living and working in Latin America",
      sections: ["Geo-Methoden – Karten lesen, Diagramme auswerten und Co."],
      videos: ["Amazonas-Regenwald – es war einmal unsere Erde (Folge 5)"] },
    { topic: "Living and working in Australia", sections: ["Australien"] },
    { topic: "Demography", videos: [
      "Benin - Bevölkerungsstruktur",
      "Industrieländer",
      "Entwicklungsländer",
    ] },
  ],

  Geschichte: [
    { topic: "Europa im Zeitalter des Absolutismus", sections: ["Absolutismus und Aufklärung"] },
    { topic: "Amerikanische Revolution und Unabhängigkeit" }, // no sofatutor video
    { topic: "Die Französische Revolution", sections: ["Französische Revolution und Napoleon"] },
    { topic: "Napoleon", videos: [
      "Napoleon",
      "Europa unter der Herrschaft Napoleons",
      "Napoleon und die Neuordnung „Deutschlands“ – der Rheinbund",
      "Napoleons Russlandfeldzug",
      "Dreikaiserschlacht bei Austerlitz",
      "Die „Befreiungskriege“",
      "Das Ende von Napoleon Bonaparte",
    ] },
  ],

  Mathematik: [
    { topic: "Terme und Formeln",
      sections: [
        "Terme aufstellen, umformen und berechnen",
        "Ausklammern und Ausmultiplizieren",
        "Binomische Formeln",
      ],
      videos: ["Formeln in der Mathematik", "Formeln umstellen"] },
    { topic: "Lineare Funktionen", sections: [
      "Funktionen – Grundlagen: Funktionsgleichungen, Funktionsgraphen und Koordinatensysteme",
      "Proportionale Funktionen",
      "Lineare Funktionen",
    ] },
    { topic: "Kreise", sections: ["Kreise – Flächeninhalt, Umfang und Tangenten"] },
    { topic: "Reelle Zahlen" }, // no sofatutor video on roots or irrational numbers
    { topic: "Wahrscheinlichkeitsrechnung", sections: [
      "Absolute und relative Häufigkeit",
      "Zufallsexperimente, Wahrscheinlichkeit, Ereignisse und Ergebnisse",
      "Baumdiagramme und Pfadregel",
      "Mehrstufige Zufallsexperimente",
    ] },
    { topic: "Satz des Pythagoras", videos: [
      "Der Satz des Pythagoras",
      "Satz des Pythagoras – Kathete gesucht",
      "Satz des Pythagoras – Beweis",
      "Satz des Pythagoras – Übungen",
    ] },
    { topic: "Körper", sections: ["Körper – Volumen und Oberfläche"] },
  ],

  Physik: [
    { topic: "Mechanik", sections: [
      "Geschwindigkeit und Energie bei der Bewegung",
      "Gleichförmige, geradlinige Bewegung",
      "Gleichmäßig beschleunigte Bewegung",
      "Verschiedene Bewegungen darstellen und interpretieren",
      "Physikalische Kräfte und ihre Wirkungen",
      "Gewichtskraft, Reibung, Federkraft und das hookesche Gesetz",
      "Kraft und Bewegung – die newtonschen Gesetze",
      "Kraftwandler – Hebel, schiefe Ebene, Flaschenzug und Wellrad",
      "Energieformen, Energieumwandlung und Energieerhaltung",
      "Mechanische Energie, Arbeit und Leistung",
      "Schwimmen und steigen – Auftrieb in Wasser und Luft",
      "Auflagedruck, Luftdruck und hydrostatischer Druck",
    ] },
    { topic: "Thermodynamik", sections: [
      "Temperatur und Temperaturmessung",
      "Aggregatzustände und Wärmekapazität",
      "Thermisches Verhalten – ausdehnen und zusammenziehen bei Temperaturänderung",
      "Teilchenmodell, Teilchenbewegung und innere Energie",
      "Wärmetransport – Wärmeleitung, Wärmeströmung und Wärmestrahlung",
    ] },
    { topic: "Elektrizitätslehre", sections: [
      "Magnete und Magnetismus",
      "Elektrische Stromkreise und Schaltungen",
      "Elektrische Ladung, Influenz und Coulombkraft",
      "Elektrischer Strom, Spannung, Widerstand und das ohmsche Gesetz",
      "Elektrische Energie, Arbeit und Leistung",
      "Elektrisches Feld und Kondensator",
      "Magnetisches Feld und Spulen",
    ] },
  ],
};

/** Fixed items in the Daily Checklist card. They reset every day. */
const DAILY_TASKS = ["Sofatutor", "Edmentum", "Wisdomhall", "Membean", "Achieve3000"];

/**
 * The checklist item that ticks itself, since the planner's videos are on
 * sofatutor: it's ticked once every video on the Today's Videos and Prepare
 * for Tomorrow cards is ticked and has its score (%) entered, and unticked
 * again if one isn't. It can't be ticked by hand. Set it to null to make
 * every item a normal checkbox.
 */
const AUTO_TICKED_TASK = "Sofatutor";

/**
 * Checklist items that need details before they can be ticked: three text
 * boxes (the names below are their placeholders, change them to suit), each
 * with the score you got on it, in percent. All of them are required. Items
 * not listed here are plain checkboxes.
 */
const TASK_DETAILS = {
  Edmentum: ["Activity 1", "Activity 2", "Activity 3"],
  Wisdomhall: ["Activity 1", "Activity 2", "Activity 3"],
  Achieve3000: ["Activity 1", "Activity 2", "Activity 3"],
};

/**
 * Checklist items that need the minutes you spent on them, typed into a box
 * beside the item, before they can be ticked.
 */
const MINUTES_TASKS = ["Membean"];
