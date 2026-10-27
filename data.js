/* ChequeIn Sales OS — content, sequences and seed data.
   Everything here is editable in the UI; this file is only the starting point. */
window.CI = (function () {
  const DAY = 86400000;

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const off = (n) => iso(new Date(Date.now() + n * DAY));

  const STAGES = [
    { id: "lead", label: "Lead", short: "Lead", hint: "Name in the list, not contacted yet." },
    { id: "contacted", label: "Contacted", short: "Contacted", hint: "First touch sent or call made." },
    { id: "qualified", label: "Qualified", short: "Qualified", hint: "Scorecard passed: 10+ staff, transfer payroll, registered." },
    { id: "demo", label: "Demo", short: "Demo", hint: "You showed the payroll flow and staff app." },
    { id: "compliance", label: "Compliance", short: "Compliance", hint: "Documents in review — the stage that kills deals." },
    { id: "live", label: "Live", short: "Live", hint: "First payroll run through ChequeIn." },
    { id: "lost", label: "Lost / park", short: "Lost", hint: "Not a fit now. Revisit next term." }
  ];

  const REQUIRED_CHECKS = [
    { id: "cac", label: "CAC certificate", detail: "Business name or limited company registration." },
    { id: "tin", label: "TIN / tax ID", detail: "Name on the TIN must match the employer." },
    { id: "address", label: "Proof of address", detail: "Utility bill or tenancy agreement, last 3 months." },
    { id: "directorId", label: "Proprietor / director ID", detail: "NIN slip, passport or driver's licence." },
    { id: "signatory", label: "Authorised signatory", detail: "Board resolution or letter naming who approves payroll." },
    { id: "bank", label: "Corporate bank account", detail: "Account name matches the registered business." },
    { id: "staffList", label: "Staff payroll file", detail: "Names, roles, salaries, bank details, start dates." },
    { id: "consent", label: "Staff consent", detail: "Signed consent for payroll and data processing." }
  ];

  const OPTIONAL_CHECKS = [
    { id: "payrollProof", label: "Last 2 payroll runs", detail: "Bank evidence that salaries are actually paid." },
    { id: "noDeductions", label: "No conflicting deductions", detail: "No existing salary loan or court deduction." }
  ];

  const QUALIFICATION = [
    { id: "staffCount", label: "Staff on payroll", type: "number", hint: "10+ is viable. Below that, the maths rarely works." },
    { id: "monthlyPayroll", label: "Monthly payroll (₦)", type: "number", hint: "Used to size the account and the revenue." },
    { id: "paidByTransfer", label: "Salaries paid by transfer", type: "bool", hint: "Cash payroll is a hard stop for now." },
    { id: "decisionMaker", label: "Decision maker engaged", type: "bool", hint: "Owner, proprietor or finance lead — not an assistant." },
    { id: "registered", label: "CAC + TIN in place", type: "bool", hint: "If not, they will fail compliance later. Park them." },
    { id: "noDeductions", label: "No existing salary deductions", type: "bool", hint: "Existing lender deductions need partner sign-off." },
    { id: "consentPossible", label: "Staff consent is realistic", type: "bool", hint: "Will they collect signed consent this term?" }
  ];

  const SEQUENCES = {
    school: {
      id: "school",
      label: "School outreach · 21 days",
      steps: [
        { gap: 0, type: "whatsapp", title: "First WhatsApp to {contact}", detail: "Intro + ask who owns payroll. Send before 9am.", script: "wa_intro" },
        { gap: 1, type: "call", title: "Call {contact}", detail: "60-second opener. Goal: a 20-minute demo.", script: "call_opener" },
        { gap: 3, type: "whatsapp", title: "Send the teacher story", detail: "Value touch, no ask. One message, one story.", script: "wa_value" },
        { gap: 5, type: "email", title: "Email the one-pager", detail: "Free payroll + what staff get.", script: "email_pack" },
        { gap: 8, type: "call", title: "Second call", detail: "Ask for the demo. Name a day and time.", script: "call_demo" },
        { gap: 12, type: "whatsapp", title: "Offer the compliance shortcut", detail: "Send the exact document list.", script: "wa_docs" },
        { gap: 16, type: "call", title: "Third call — decision maker", detail: "Ask for a yes or no by Friday.", script: "call_dm" },
        { gap: 21, type: "whatsapp", title: "Break-up message", detail: "Leave the door open, then stop.", script: "wa_breakup" }
      ]
    },
    activation: {
      id: "activation",
      label: "Activation · first 30 days",
      steps: [
        { gap: 0, type: "session", title: "Run staff onboarding at {name}", detail: "20 minutes, on-site. Everyone opens the app.", script: "activation_session" },
        { gap: 1, type: "whatsapp", title: "Check who hasn't activated", detail: "Send the list back to the contact.", script: "activation_nudge" },
        { gap: 3, type: "review", title: "Payday savings push", detail: "Salary day: ask staff to move a small amount.", script: "payday_push" },
        { gap: 7, type: "review", title: "Start a team savings challenge", detail: "Small amounts, visible progress.", script: "savings_challenge" },
        { gap: 14, type: "review", title: "Introduce salary access", detail: "Only for staff with 2+ salary cycles.", script: "ewa_intro" },
        { gap: 30, type: "review", title: "30-day activation review", detail: "Activation, savings, EWA, revenue. Decide the next push.", script: "activation_review" }
      ]
    },
    recovery: {
      id: "recovery",
      label: "Failed compliance · fix or drop",
      steps: [
        { gap: 0, type: "call", title: "Triage call to {name}", detail: "Find the exact blocker, not 'documents missing'.", script: "recovery_call" },
        { gap: 2, type: "whatsapp", title: "Send the fix list", detail: "Only the missing items. Photos are fine.", script: "recovery_docs" },
        { gap: 7, type: "call", title: "Follow up on documents", detail: "Walk them through it while they look.", script: "recovery_call" },
        { gap: 14, type: "review", title: "Decide: fix or drop", detail: "No movement in 14 days = not a fit this quarter." }
      ]
    }
  };

  const SCRIPTS = {
    wa_intro: {
      title: "First WhatsApp",
      channel: "WhatsApp",
      when: "Day 0 · send before 9am, while they're doing admin",
      body: `Good morning {contact} — my name is {you}, I'm with ChequeIn.\n\nWe help Lagos schools run payroll at no cost: salaries paid on time, and every staff member gets a ChequeIn account for savings and for accessing salary they have already earned.\n\nAre you the one who handles staff salaries at {employer}?`
    },
    call_opener: {
      title: "60-second opener",
      channel: "Phone",
      when: "Day 1 · call the number from Google Maps or the school website",
      body: `Good afternoon {contact}, this is {you} from ChequeIn. I'll keep this to 60 seconds.\n\nWe pay school salaries free of charge. The school keeps its money, staff are paid on time, and each teacher gets a savings account and salary access through our app.\n\nIs payroll something you handle directly, or does your accountant run it?\n\n[If them] “Can I show you the flow in 20 minutes? Tuesday or Thursday — which is quieter?”\n[If accountant] “Who signs it off — you or the accountant? I'll send one message and you can decide together.”`
    },
    wa_value: {
      title: "The teacher story",
      channel: "WhatsApp",
      when: "Day 3 · no ask, just proof",
      body: `Quick example, {contact}: a teacher on ₦120,000 at one of our schools was always borrowing by the 20th.\n\nShe now moves ₦5,000 to savings on payday and has a buffer by month-end. Salary access means she doesn't need a loan app at all.\n\nIt costs the school nothing. If payroll is on your list this term, I'll show you in 20 minutes.`
    },
    email_pack: {
      title: "One-pager email",
      channel: "Email",
      when: "Day 5 · use the employer's generic info@ address too",
      subject: "Free payroll for {employer} — no cost to the school",
      body: `Dear {contact},\n\nI'm {you} from ChequeIn. We would like to run {employer}'s payroll free of charge.\n\nWhat the school gets\n• Salaries paid on time, every month, with a clean payroll record\n• No payroll fee, no setup fee\n• Each staff member gets a ChequeIn account for savings and earned-salary access\n\nWhat you need to provide\n• CAC certificate, TIN and proof of address\n• Director ID and authorised signatory\n• Staff payroll file and signed staff consent\n\nSetup takes about one week once the documents are in. I'd need 20 minutes to show you the flow — would Thursday at 10am work?\n\n{sender_name}\n{your_phone} · ChequeIn`
    },
    call_demo: {
      title: "Second call — ask for the demo",
      channel: "Phone",
      when: "Day 8 · after the one-pager",
      body: `Hi {contact}, it's {you} from ChequeIn — following up on the message I sent about free payroll.\n\nI'd like 20 minutes to show you two things: how payroll runs on your side, and what your staff see on their phones. If it isn't a fit after that, I'll leave you alone.\n\nDoes Thursday 10am work, or is Friday afternoon better?`
    },
    wa_docs: {
      title: "Compliance shortcut",
      channel: "WhatsApp",
      when: "Day 12 · make compliance feel small",
      body: `{contact}, if {employer} wants to go live this term, here is the exact list:\n\n1. CAC certificate\n2. TIN\n3. Proof of address\n4. Director / proprietor ID\n5. Authorised signatory letter\n6. Corporate account details\n7. Staff list (names, roles, salaries, bank)\n8. Signed staff consent\n\nSend photos of what you have today and I'll mark the gaps. Most schools are approved within a week of sending everything.`
    },
    call_dm: {
      title: "Third call — yes or no",
      channel: "Phone",
      when: "Day 16 · ask for the decision maker",
      body: `{contact}, it's {you} from ChequeIn. I've sent the checklist twice and I don't want to keep guessing.\n\nCan I speak to whoever signs off payroll? If that's you, I need a yes or no by Friday so I can hold an onboarding slot for {employer}.\n\nIf it's a no this term, tell me and I'll come back next term instead.`
    },
    wa_breakup: {
      title: "Break-up message",
      channel: "WhatsApp",
      when: "Day 21 · then move to nurture",
      body: `Hi {contact} — I'll stop here so I'm not a nuisance.\n\nIf free payroll or staff savings becomes a priority this term, reply “payroll” and I'll pick it up the same day.\n\nWishing {employer} a strong term.`
    },
    activation_session: {
      title: "20-minute staff session",
      channel: "In person",
      when: "Go-live day · run it at the school, not over a link",
      body: `0–2 min — Why we're here\n“Your salary will land in ChequeIn this month. No fee to you. Your account is yours, not the school's.”\n\n2–5 min — Get in\nDownload the app, sign up with the phone number payroll has, BVN, ID. Help the two people who always struggle first.\n\n5–8 min — Salary\n“This is where your salary lands. You can check it, and your balance is yours.”\n\n8–12 min — Savings\n“On payday, move ₦2,000 — or whatever is real — before you spend. Do it once and it becomes a habit.”\n\n12–15 min — Salary access\n“If you need money before payday, you can access salary you've already earned. Capped, fee shown upfront. It is not a loan and it is not free money.”\n\n15–20 min — Questions + who needs help\nWrite down the names of anyone who didn't finish. Send that list to the employer contact the same day.\n\nDo not promise credit. Do not promise a limit.`
    },
    activation_nudge: {
      title: "Activation nudge to the employer",
      channel: "WhatsApp",
      when: "Day 1 after the session",
      body: `{contact}, thank you for the time yesterday. {n} of {total} staff finished setting up.\n\nHere are the ones still pending: [names]. A one-line message from you usually gets them over the line — can you nudge them before payday?\n\nI'll send a reminder on salary day.`
    },
    payday_push: {
      title: "Payday push",
      channel: "WhatsApp / staff group",
      when: "Salary day, 9am · the highest-leverage message you send",
      body: `Your salary is in. 🎉\n\nBefore you spend anything, move ₦2,000 to savings. It takes 30 seconds and it's the difference between a hard month and a manageable one.\n\nReply “done” and I'll add you to this month's savings list.`
    },
    savings_challenge: {
      title: "Team savings challenge",
      channel: "WhatsApp / staff group",
      when: "Day 7 · make saving social",
      body: `This term's staff challenge: save ₦2,000 on every payday for 3 months.\n\nNo judgement, no minimum income. The only rule is that it comes out before spending.\n\nWe'll share the group total each payday — no names, just the number. Who's in?`
    },
    ewa_intro: {
      title: "Introducing salary access",
      channel: "WhatsApp / staff group",
      when: "Day 14 · only after 2 clean salary cycles",
      body: `One more thing you now have: salary access.\n\nIf money is tight before payday, you can access part of the salary you have already earned — not a loan, capped at what you've earned, with the fee shown before you confirm.\n\nUse it for a gap, not for a habit. Savings first.`
    },
    activation_review: {
      title: "30-day activation review",
      channel: "Call / meeting",
      when: "Day 30 · with the employer contact",
      body: `{contact}, one month in. Here's where {employer} stands:\n\n• Staff paid through ChequeIn: {paid}\n• Staff using savings: {savings}\n• Staff using salary access: {ewa}\n• Issues raised by staff: {issues}\n\nWhat would make the biggest difference next month — getting the remaining staff on, or getting savers to save consistently?`
    },
    recovery_call: {
      title: "Triage call",
      channel: "Phone",
      when: "Same week compliance failed",
      body: `Good morning {contact}, this is {you} from ChequeIn. We reviewed {employer}'s application and it stopped at {reason}.\n\nUsually that's a document, not a no. Which of these is true — you don't have it, it's in another name, or it's expired?\n\nIf you can send it this week, we can restart the review and still get you live this month.`
    },
    recovery_docs: {
      title: "The fix list",
      channel: "WhatsApp",
      when: "After the triage call · only the missing items",
      body: `{contact}, to restart {employer} we only need:\n\n• {doc1}\n• {doc2}\n\nPhotos on WhatsApp are fine. Once received, compliance takes 2–3 working days. If either one doesn't exist, tell me and we'll look at an alternative.`
    }
  };

  const OBJECTIONS = [
    {
      q: "“We already use a payroll provider.”",
      a: "Keep them for now. Let us run one parallel payroll free of charge. If your staff don't prefer it, you've lost nothing but an hour. If they do, you stop paying the other provider."
    },
    {
      q: "“Is this a loan app?”",
      a: "No. Salary access lets staff reach salary they have already earned — capped, with the fee shown before they confirm. Savings is the default habit, not borrowing."
    },
    {
      q: "“What's the catch? Nothing is free.”",
      a: "No fee to the school. Salaries must be paid through ChequeIn, and we earn when staff choose savings or salary access. If staff don't use it, we don't earn — which is why we run the staff session ourselves."
    },
    {
      q: "“Our staff won't use it.”",
      a: "That's the normal first reaction. We run a 20-minute session on-site, nudge the ones who don't finish, and send a payday message. At our live schools, a third of staff used salary access in the first month — the ones who don't, still get paid on time."
    },
    {
      q: "“Why do you need staff data?”",
      a: "Payroll needs names, salaries and bank details. Consent is explicit and signed, the account is held with our partner bank, and data is used for payroll and eligibility only. I'll send the consent form before anyone signs."
    },
    {
      q: "“We pay salaries in cash.”",
      a: "Then we can't help yet — cash means no salary trail and no account to pay into. When you move to transfers, call me and we'll set it up in a week."
    },
    {
      q: "“Too busy this term.”",
      a: "Understood — the term is the busy part. The setup is about one week and I do the work. Can we book the kickoff for the first week of next term, so it's done before resumption?"
    }
  ];

  const SOURCING = [
    {
      label: "Private schools · Ikeja",
      detail: "Google Maps gives you name, phone and address in one pass.",
      href: "https://www.google.com/maps/search/private+schools+in+Ikeja+Lagos"
    },
    {
      label: "Private schools · Surulere",
      detail: "Dense cluster of 20–80 staff schools.",
      href: "https://www.google.com/maps/search/private+schools+in+Surulere+Lagos"
    },
    {
      label: "Private schools · Lekki / Ajah",
      detail: "Higher fee schools, larger payrolls.",
      href: "https://www.google.com/maps/search/private+schools+in+Lekki+Lagos"
    },
    {
      label: "School administrators on LinkedIn",
      detail: "Search by title, then ask for the proprietor.",
      href: "https://www.linkedin.com/search/results/people/?keywords=school%20administrator%20Lagos"
    },
    {
      label: "NAPPS Lagos chapters",
      detail: "Association lists are the fastest route to owners.",
      href: "https://www.google.com/search?q=NAPPS+Lagos+chapter+private+schools+list"
    },
    {
      label: "Hospital / clinic administrators",
      detail: "Shift staff, monthly payroll, same compliance profile.",
      href: "https://www.google.com/maps/search/private+hospitals+in+Lagos"
    }
  ];

  const RED_FLAGS = [
    { title: "Cash-paid staff", detail: "No salary trail. Disqualify until they move to transfers." },
    { title: "No CAC or TIN", detail: "Cannot pass compliance with a partner bank. Park, don't promise." },
    { title: "Payroll file vs bank credits mismatch", detail: "The file says ₦180,000, the account receives ₦90,000. Ask before review." },
    { title: "Owner refuses staff consent", detail: "A hard stop. No consent, no accounts." },
    { title: "Existing salary loans", detail: "Needs partner sign-off on deduction priority before you sell." },
    { title: "Fewer than 10 staff", detail: "Revenue per employer rarely covers the onboarding effort." },
    { title: "Term-time only staff", detail: "Seasonal payroll breaks the savings and repayment rhythm." }
  ];

  const FAILURES = [
    { reason: "CAC certificate missing", note: "Common and fixable — many schools registered the business name but never collected the certificate." },
    { reason: "TIN name mismatch", note: "TIN is in the proprietor's name, not the school's. Fixable with a status update." },
    { reason: "Director KYC incomplete", note: "ID expired or NIN slip missing. One document away." },
    { reason: "No staff consent forms", note: "Fixable — send the consent template and collect signatures at the next staff meeting." },
    { reason: "Staff paid in cash", note: "Not a fit until payroll moves to transfers. Park for next term." },
    { reason: "Bank account not in business name", note: "Fixable, but slow — the account must match the CAC name." },
    { reason: "Payroll file doesn't match bank credits", note: "Investigate first: could be allowances or multiple accounts." }
  ];

  function blankChecks() {
    const c = {};
    REQUIRED_CHECKS.concat(OPTIONAL_CHECKS).forEach((x) => { c[x.id] = null; });
    return c;
  }

  function allChecks(value) {
    const c = {};
    REQUIRED_CHECKS.concat(OPTIONAL_CHECKS).forEach((x) => { c[x.id] = value; });
    return c;
  }

  function stepAction(seqId, stepIndex, employer) {
    const seq = SEQUENCES[seqId];
    const step = seq.steps[stepIndex];
    const name = employer.contact || employer.name;
    const fill = (s) => String(s).replace(/\{name\}/g, employer.name).replace(/\{contact\}/g, name);
    return {
      seq: seqId,
      step: stepIndex,
      type: step.type,
      title: fill(step.title),
      detail: fill(step.detail),
      script: step.script || null,
      due: off(step.gap)
    };
  }

  function seed() {
    const employers = [
      {
        id: "e_willb",
        name: "Will'B' Excellence Schools",
        segment: "School",
        city: "Lagos",
        contact: "",
        role: "Proprietor",
        phone: "",
        email: "",
        source: "Existing customer",
        staffEstimate: 52,
        stage: "live",
        createdAt: off(-95),
        qualification: { staffCount: 52, monthlyPayroll: 7800000, paidByTransfer: true, decisionMaker: true, registered: true, noDeductions: true, consentPossible: true, demoDone: true },
        compliance: { checks: allChecks(true), notes: "", failReason: "", fixable: null },
        metrics: { employees: 52, ewaActive: 18, savingsFunded: 5, revenue: 15600 },
        nextAction: stepAction("activation", 0, { name: "Will'B' Excellence Schools", contact: "" }),
        activity: [
          { date: off(-95), type: "note", text: "First payroll run through ChequeIn." },
          { date: off(-4), type: "note", text: "Only 5 of 52 staff have funded savings. Activation is the gap." }
        ],
        notes: "Two schools passed compliance; this is the largest live payroll. Push the staff session this week."
      },
      {
        id: "e_espana",
        name: "Espana Carabana",
        segment: "Other",
        city: "Lagos",
        contact: "",
        role: "Owner",
        phone: "",
        email: "",
        source: "Existing customer",
        staffEstimate: 34,
        stage: "live",
        createdAt: off(-88),
        qualification: { staffCount: 34, monthlyPayroll: 5100000, paidByTransfer: true, decisionMaker: true, registered: true, noDeductions: true, consentPossible: true, demoDone: true },
        compliance: { checks: allChecks(true), notes: "", failReason: "", fixable: null },
        metrics: { employees: 34, ewaActive: 12, savingsFunded: 3, revenue: 10200 },
        nextAction: stepAction("activation", 2, { name: "Espana Carabana", contact: "" }),
        activity: [
          { date: off(-88), type: "note", text: "First payroll run through ChequeIn." },
          { date: off(-2), type: "note", text: "Payday this week — savings push is the priority." }
        ],
        notes: "34 staff paid. Savings is thin; the payday message is the lever."
      },
      {
        id: "e_oriented",
        name: "Oriented Souls",
        segment: "School",
        city: "Lagos",
        contact: "",
        role: "Proprietor",
        phone: "",
        email: "",
        source: "Existing customer",
        staffEstimate: 20,
        stage: "live",
        createdAt: off(-70),
        qualification: { staffCount: 20, monthlyPayroll: 2600000, paidByTransfer: true, decisionMaker: true, registered: true, noDeductions: true, consentPossible: true, demoDone: true },
        compliance: { checks: allChecks(true), notes: "", failReason: "", fixable: null },
        metrics: { employees: 20, ewaActive: 5, savingsFunded: 0, revenue: 6105 },
        nextAction: stepAction("activation", 5, { name: "Oriented Souls", contact: "" }),
        activity: [
          { date: off(-70), type: "note", text: "First payroll run through ChequeIn." },
          { date: off(-1), type: "note", text: "30-day activation review due. No savings funded yet." }
        ],
        notes: "Smallest payroll. Use it as the proof point for a referral to two sister schools."
      }
    ];

    FAILURES.forEach((f, i) => {
      const id = "e_failed_" + (i + 1);
      employers.push({
        id,
        name: "Failed employer " + (i + 1),
        segment: "Unconfirmed",
        city: "",
        contact: "",
        role: "",
        phone: "",
        email: "",
        source: "Signed up, failed compliance",
        staffEstimate: 0,
        stage: "compliance",
        createdAt: off(-60 + i),
        qualification: { staffCount: null, monthlyPayroll: null, paidByTransfer: null, decisionMaker: null, registered: null, noDeductions: null, consentPossible: null, demoDone: false },
        compliance: { checks: blankChecks(), notes: "", failReason: f.reason, fixable: null, failureIndex: i },
        metrics: { employees: 0, ewaActive: 0, savingsFunded: 0, revenue: 0 },
        nextAction: stepAction("recovery", 0, { name: "Failed employer " + (i + 1), contact: "" }),
        activity: [{ date: off(-60 + i), type: "note", text: "Compliance stopped: " + f.reason }],
        notes: f.note + " Rename this record to the real employer."
      });
    });

    return {
      version: 1,
      employers: employers,
      revPerActive: 900,
      seededAt: new Date().toISOString(),
      revPerEmployee: 300,
      baseline: {
        asOf: "2026-10-27",
        employersTotal: 11,
        employersPassed: 4,
        employersLive: 3,
        employees: 106,
        revenue: 31905,
        signups30d: 25,
        kyc: 24,
        savingsFunded: 2,
        retained30d: 1,
        ewaPenetration: 0.33,
        savingsRate: 0.08,
        repayment: 0.064
      },
      targets: {
        weekly: { whatsapp: 25, calls: 15, demos: 3, compliancePacks: 2, onboardings: 1 },
        quarter: { employersLive: 8, activeEmployees: 400, revenuePerEmployee: 450, compliancePass: 0.7, activation: 0.5, savingsRate: 0.25, retention: 0.4, repayment: 0.9 }
      },
      tasks: [
        {
          id: "t_list",
          title: "Build a 25-school target list",
          detail: "Ikeja, Surulere and Lekki. Use the sourcing links, add name + phone + staff count, and start the cadence.",
          due: off(0),
          type: "admin",
          done: false,
          route: "pipeline",
          anchor: "source"
        },
        {
          id: "t_rename",
          title: "Rename and triage the 7 failed employers",
          detail: "Replace the placeholders with real names, then mark each one fixable or not a fit.",
          due: off(0),
          type: "admin",
          done: false,
          route: "compliance",
          anchor: "triage"
        },
        {
          id: "t_activation",
          title: "Book the Will'B' staff session",
          detail: "Call the proprietor and lock a 20-minute slot on go-live day. Bring the session script.",
          due: off(0),
          type: "admin",
          done: false,
          route: "playbook",
          anchor: "activation"
        },
        {
          id: "t_log",
          title: "Log this week's numbers",
          detail: "Calls, WhatsApps, demos, compliance packs. The weekly scorecard is only as good as the log.",
          due: off(2),
          type: "admin",
          done: false,
          route: "numbers",
          anchor: "scorecard"
        }
      ],
      log: {},
      checklist: {
        "Booked staff sessions at the 3 live employers": false,
        "Listed 25 schools with phone numbers": false,
        "Sent the first 10 WhatsApp openers": false,
        "Booked the first demo": false,
        "Sent one compliance pack this week": false
      }
    };
  }

  return {
    DAY, iso, off, STAGES, REQUIRED_CHECKS, OPTIONAL_CHECKS, QUALIFICATION,
    SEQUENCES, SCRIPTS, OBJECTIONS, SOURCING, RED_FLAGS, FAILURES,
    blankChecks, allChecks, stepAction, seed
  };
})();
