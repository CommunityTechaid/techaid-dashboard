/**
 * The recipient equalities questions, transcribed from the live Typeform
 * "Recipient Equalities Data 2025/2026" (form id f93D0s88) on 2026-11-02.
 *
 * `ref` is the Typeform field ref, kept so a future submission can be mapped onto the
 * existing Google Sheet columns without guessing.
 */
export interface EqualitiesQuestion {
  ref: string;
  key: string;
  title: string;
  description?: string;
  choices: string[];
  /** Typeform logic: skip this question when a previous answer matches. */
  skipWhen?: { key: string; equals: string };
}

export const EQUALITIES_INTRO =
  'In order for us to continue providing our services we need some additional information about the client ' +
  'you are supporting. This information is anonymous.';

export const EQUALITIES_QUESTIONS: EqualitiesQuestion[] = [
  {
    ref: '6641afcc-c032-4bf6-b4b5-588132614da1',
    key: 'organisationType',
    title: 'What type of organisation are you?',
    description:
      'Please select the one that is most appropriate or the one which applies most to the type of support you are providing.',
    choices: [
      'Campaign and self-advocacy group',
      'Domestic abuse support',
      'Education and training',
      'Food bank',
      'Heritage and the arts',
      'Library',
      'Mental health support',
      'Prison leavers support',
      'Refugee support',
      'Religion',
      'School',
      'Social Relief and care',
      'Sport and recreation',
      'Support for 65+',
      'Support for the homeless',
      'Support for those with disabilities',
      'Tenants and Residents’ Association',
      'Women empowerment',
      'Young carers',
      'Young People and youth issues',
    ],
  },
  {
    ref: 'c587ee55-20cc-4fb3-827f-f3cae0f07e6b',
    key: 'age',
    title: "What is your client's age?",
    choices: ['0-10', '11-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'],
  },
  {
    ref: '85c099aa-bc3e-4a3b-96d5-1c19d816b8f7',
    key: 'gender',
    title: "Which of the following best describes your client's gender?",
    choices: [
      'Male (including trans man)',
      'Female (including trans woman)',
      'Prefer not to say',
      'Non-binary or genderqueer',
      'Prefer to self-describe',
    ],
  },
  {
    ref: '5d61b4c1-fb46-4ad1-8f10-40a63bc1de6a',
    key: 'sexualOrientation',
    title: "Which of the following best describes your client's sexual orientation?",
    choices: ['Heterosexual or straight', 'Gay or Lesbian', 'Bisexual', 'Pansexual', 'Asexual', 'Prefer to self-describe'],
  },
  {
    ref: '35abf175-583c-4b98-94e4-99f2b6044e09',
    key: 'stateBenefits',
    title: 'Does your client receive state benefits?',
    description: 'Including UC, PIP etc.',
    choices: ['Yes', 'No', "Don't know"],
  },
  {
    ref: '09798133-121e-4923-9a07-67747d73cd8e',
    key: 'noRecourseToPublicFunds',
    title: 'Is your client No Recourse to Public Funds?',
    choices: ['Yes', 'No', "Don't know"],
    // Typeform jumps straight from "benefits = Yes" to the disability question.
    skipWhen: { key: 'stateBenefits', equals: 'Yes' },
  },
  {
    ref: '72f32c3c-ea9a-4bb8-acd8-8a5c034c4d3d',
    key: 'disability',
    title: 'Does your client consider themselves to have a disability or long term health condition?',
    choices: ['Yes', 'No', 'Prefer not to say'],
  },
  {
    ref: '096a6841-3d23-4b3f-a0f3-ce57fc3e31eb',
    key: 'ethnicity',
    title: "What is your client's race or ethnic group?",
    choices: [
      'Asian or Asian British',
      'Black, African, Caribbean or Black British',
      'Arab or MENA',
      'Latin American or Hispanic',
      'White',
      'Mixed or Multiple ethnic groups',
      'Other',
      'Unknown',
    ],
  },
  {
    ref: 'bf1a26ac-58cb-43b1-aa9c-ec9bda8f5c5e',
    key: 'housing',
    title: "What is your client's housing status?",
    choices: [
      'Home owner',
      'Tenant (private housing)',
      'Tenant (social/council housing)',
      'Temporary accommodation (including hotels and hostels)',
      'No fixed address',
      "Don't know",
    ],
  },
  {
    ref: '1a91d17e-3639-48bf-a6d0-cd99fd18e5e2',
    key: 'education',
    title: 'Is your client in education?',
    choices: ['Yes', 'No', 'Enrolled but not started', "Don't know"],
  },
  {
    ref: '1190bad0-2fb8-4c53-abc3-d5afbf2fe997',
    key: 'working',
    title: 'Is your client working?',
    choices: [
      'Yes - full time',
      'Yes - part time',
      'Yes - self employed',
      'No',
      'Unable to work (for example due to caring responsibilities, disability, etc.)',
      "Don't know",
    ],
  },
];
