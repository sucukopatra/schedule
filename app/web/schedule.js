/* ---------------------------------------------------------------------------
   The timetable. Data only — edit this file, reload, done. No build step, and
   nothing in app.js needs to know about your changes.

     day    'Mon'..'Sun', a list of them, or '*' for every day
     at     'HH:MM-HH:MM', 24-hour
     kind   class   fixed lecture or lab
            deep    open session you assign a category to      (tickable)
            gym     (tickable)
            habit   small recurring thing                      (tickable)
            review  (tickable)
            anchor  fixed non-class commitment (meals, spare time)
            trip    away from home
            light   loose, optional
     note   dimmer second line, optional
     track  counts toward the meter of this name
     weeks  which week types it shows up in; omit for all of them

   A week type can name the ISO weeks it applies to (isoWeeks, below), so trip
   and exam weeks arrive on their own instead of waiting to be remembered.

   Tickable blocks get a stable id from their kind, day and start time, so
   moving a block loses its ticks for that week. That is usually what you want.
   --------------------------------------------------------------------------- */

var SCHEDULE = {
  term: 'Fall 2026',

  gridStart: '07:00',
  gridEnd:   '24:00',
  wake:      { weekday: '07:30', weekend: '08:30' },
  lightsOut: '23:30',

  /* The term's first and last day, used only to generate schedule.ics — the
     page itself does not care. Both are inclusive, YYYY-MM-DD. */
  termStart: '2026-09-14',
  termEnd:   '2026-12-22',

  /* Minutes of warning in the calendar feed, by kind. A kind that is not
     listed gets no alarm, which is why habit is absent: they are small and
     daily, and a ping for every one of them is how a phone learns to be
     ignored. */
  alarms: { class: 30, gym: 15, deep: 10, review: 10, trip: 60 },

  /* isoWeeks: the weeks this type takes over, as ISO week strings. The type is
     set when the week rolls over on Monday; the buttons in the header still
     override it for the rest of that week. A week no type claims is normal, so
     `normal` never needs a list. Two types must not claim the same week. */
  weeks: {
    normal: { label: 'Normal', targets: { coursework: 3, software: 2, chess: 1, gym: 3 } },
    trip:   { label: 'Trip',   targets: { coursework: 2, software: 1, chess: 1, gym: 2 }, isoWeeks: [] },
    /* Midterms 1–8 Nov, finals 12–22 Dec. Both periods straddle a week
       boundary, and every week either one touches is listed: W44 holds only
       Sunday 1 Nov and W50 only the weekend of 12–13 Dec, but those are the
       run-ups, which is when the exam targets are worth having. Drop either
       one if you would rather keep that week normal. */
    exam:   { label: 'Exam',   targets: { coursework: 6, software: 0, chess: 0, gym: 2 },
              isoWeeks: ['2026-W44', '2026-W45', '2026-W50', '2026-W51', '2026-W52'] }
  },

  categories: {
    coursework: { label: 'Coursework',       hint: 'Either major: homework, projects, exam prep',    color: 'var(--cw)' },
    software:   { label: 'Software project', hint: 'Your portfolio project for general software dev', color: 'var(--sw)' },
    chess:      { label: 'Chess study',      hint: 'A Caro-Kann chapter or a tactics set',            color: 'var(--ch)' }
  },

  /* Meters with no target in weeks.targets: the target is however many are
     scheduled that week, i.e. "do all of them". Anki keeps the `german`
     track, so the German history from before Nicos Weg carries on. */
  habitMeters: [
    { track: 'german',   label: 'Anki'      },
    { track: 'nicosweg', label: 'Nicos Weg' },
    { track: 'reading',  label: 'Reading'   },
    { track: 'longread', label: 'Long read' }
  ],

  blocks: [
    /* --- every week ------------------------------------------------------ */
    { day: ['Mon','Tue','Wed','Thu','Fri'], at: '07:45-08:00', kind: 'habit', title: 'Anki',    note: 'Nouns with der/die/das', track: 'german' },
    { day: ['Sat','Sun'],                   at: '09:00-09:15', kind: 'habit', title: 'Anki',    note: 'Nouns with der/die/das', track: 'german' },
    { day: '*',                             at: '22:30-23:00', kind: 'habit', title: 'Reading', note: 'Before bed',             track: 'reading' },

    /* --- Monday: longest day, so the evening stays light ----------------- */
    { day: 'Mon', at: '09:00-11:00', kind: 'class', title: 'GAME 207',     note: 'E2-210' },
    { day: 'Mon', at: '11:00-13:00', kind: 'class', title: 'PHYS 101 lab', note: 'E2-101, 12:00 online' },
    { day: 'Mon', at: '14:00-17:00', kind: 'class', title: 'CMPE 100',     note: 'E1-102' },
    { day: 'Mon', at: '17:00-19:00', kind: 'class', title: 'CMPE 100 lab', note: 'E3-304' },
    { day: 'Mon', at: '20:00-20:30', kind: 'habit', title: 'Nicos Weg',    note: 'Next lesson, in order', track: 'nicosweg' },

    /* --- Tuesday --------------------------------------------------------- */
    { day: 'Tue', at: '09:00-12:00', kind: 'class', title: 'PHYS 101',     note: 'ÇSM-203, GAME 201 online at 10' },
    { day: 'Tue', at: '12:00-14:00', kind: 'class', title: 'GAME 201 lab', note: 'E1-219' },
    { day: 'Tue', at: '14:00-16:00', kind: 'class', title: 'CHEM 110 lab', note: 'ÇSM-305' },
    { day: 'Tue', at: '16:00-18:00', kind: 'deep',  title: 'Deep session' },
    { day: 'Tue', at: '18:30-19:45', kind: 'gym',   title: 'Gym',          note: '5x5', track: 'gym' },

    /* --- Wednesday ------------------------------------------------------- */
    { day: 'Wed', at: '09:00-11:30', kind: 'anchor', title: 'Spare morning' },
    { day: 'Wed', at: '12:00-14:00', kind: 'class',  title: 'MATH 169',             note: 'E4-305' },
    { day: 'Wed', at: '14:00-16:00', kind: 'deep',   title: 'Deep session' },
    { day: 'Wed', at: '16:00-19:00', kind: 'class',  title: 'GAME 209',             note: 'E2-107' },
    { day: 'Wed', at: '19:30-22:00', kind: 'anchor', title: 'Meal prep',            note: 'At Baki’s, cooks for Thu–Sat',   weeks: ['normal','exam'] },
    { day: 'Wed', at: '19:30-22:00', kind: 'anchor', title: 'Meal prep, big batch', note: 'Freeze some for after the trip', weeks: ['trip'] },

    /* --- Thursday -------------------------------------------------------- */
    { day: 'Thu', at: '09:00-12:00', kind: 'class', title: 'CHEM 101',     note: 'ÇSM-204' },
    { day: 'Thu', at: '12:00-13:00', kind: 'class', title: 'MATH 169 PS',  note: 'ÇSM-Z08' },
    { day: 'Thu', at: '14:00-16:00', kind: 'class', title: 'GAME 211 lab', note: 'E1-219' },
    { day: 'Thu', at: '16:00-18:00', kind: 'deep',  title: 'Deep session' },
    { day: 'Thu', at: '18:30-19:45', kind: 'gym',   title: 'Gym',          note: '5x5', track: 'gym' },
    { day: 'Thu', at: '20:30-21:00', kind: 'habit', title: 'Nicos Weg',    note: 'Next lesson, in order', track: 'nicosweg' },

    /* --- Friday: the long work day, done by 18:00 ------------------------ */
    { day: 'Fri', at: '08:15-09:45', kind: 'deep',  title: 'Deep session' },
    { day: 'Fri', at: '10:00-12:00', kind: 'class', title: 'GAME 203 lab',       note: 'E1-219' },
    { day: 'Fri', at: '12:30-14:00', kind: 'deep',  title: 'Deep session' },
    { day: 'Fri', at: '14:00-16:00', kind: 'class', title: 'MATH 169',           note: 'E1-306' },
    { day: 'Fri', at: '16:00-18:00', kind: 'deep',  title: 'Deep session' },
    { day: 'Fri', at: '19:30-22:00', kind: 'trip',  title: 'Leave for the trip', weeks: ['trip'] },

    /* --- Saturday -------------------------------------------------------- */
    { day: 'Sat', at: '10:00-11:15', kind: 'gym',    title: 'Gym',          note: '5x5', track: 'gym',                          weeks: ['normal','exam'] },
    { day: 'Sat', at: '11:45-12:15', kind: 'habit',  title: 'Nicos Weg',    note: 'Next lesson, in order', track: 'nicosweg', weeks: ['normal','exam'] },
    { day: 'Sat', at: '19:00-22:30', kind: 'anchor', title: 'Free evening', note: 'Nothing planned. Russian if German is on track', weeks: ['normal','exam'] },
    { day: 'Sat', at: '08:30-22:00', kind: 'trip',   title: 'Trip',         note: 'Monthly weekend out of İstanbul', weeks: ['trip'] },

    /* --- Sunday ---------------------------------------------------------- */
    { day: 'Sun', at: '11:00-12:30', kind: 'habit',  title: 'Long read',     note: 'A proper sit-down with the book', track: 'longread', weeks: ['normal','exam'] },
    { day: 'Sun', at: '14:00-15:30', kind: 'review', title: 'Weekly review', note: 'Check counts, preview CompEng, plan slots', weeks: ['normal','exam'] },
    { day: 'Sun', at: '16:00-18:30', kind: 'anchor', title: 'Meal prep',     note: 'At Baki’s, cooks for Mon–Wed',    weeks: ['normal','exam'] },
    { day: 'Sun', at: '19:30-21:00', kind: 'light',  title: 'Chess games',   note: 'Play rapid, then review',         weeks: ['normal','exam'] },
    { day: 'Sun', at: '08:30-20:30', kind: 'trip',   title: 'Trip',          note: 'Heading back in the evening',     weeks: ['trip'] },
    { day: 'Sun', at: '21:00-21:30', kind: 'review', title: 'Quick review',  note: '30 min when back',                weeks: ['trip'] }
  ]
};
