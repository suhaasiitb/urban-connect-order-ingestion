import { describe, expect, it } from 'vitest';
import {
  normalizeRiderName,
  parseActiveRidersFile,
} from '../../src/services/activeRiderService';

const SAMPLE_CSV = `"Name","Phone","Online Status","Eligibility","Attendance","Store"
"Shubham suresh giri ","9518538846","Offline","Eligible","NA","TMK7"
"Satish swami","7887846774","Offline","Eligible","NA","TMK7"
"Ajinkya Bhadirge","8237992258","Offline","Eligible","NA","TMK7"
"Ritesh Santosh Gaikwad","7410017921","Offline","Eligible","NA","TMK7"
"Ajinkya Ravindra Bhadirge","8767045258","Offline","Eligible","NA","TMK7"
"Vishal Vitthal More","7058474916","Offline","Eligible","NA","TMK7"
"Rajankumar Ramesh Sah ","7397843387","Offline","Eligible","NA","TMK7"
"SAMARTH SANJAY GHODAKE ","7083608570","Offline","Eligible","NA","TMK7"
"Ganesh shekokar","7219641472","Offline","Eligible","NA","TMK7"
"Karan Arjun Gavhande","8080695858","Offline","Eligible","NA","TMK7"
"Chate Ashok Bharat","9607206965","Offline","Eligible","NA","TMK7"
"Shubham ramesh kaithal ","9112436488","Offline","Eligible","NA","TMK7"
"Savidhan kisan Wahule","9579835447","Offline","Eligible","NA","TMK7"
"Ganesh shankar pawar ","9623721484","Offline","Eligible","NA","TMK7"
"Satish Baburao Sutar","9112151866","Offline","Eligible","NA","TMK7"
"AYUSH CHAVAN","9373943058","Offline","Ineligible","NA","TMK7"
"Rohit Sangale","9307645413","Offline","Eligible","NA","TMK7"
"NILESH SHIRKE","9284959456","Offline","Eligible","NA","TMK7"
"DHARMA CHANDANE","7666939093","Offline","Eligible","NA","TMK7"
"ANSU VARMA","8329522693","Offline","Ineligible","NA","TMK7"
"Kunal Bedse ","9356956504","Offline","Ineligible","NA","TMK7"
"praveen gadade","8329805990","Offline","Eligible","NA","TMK7"
"rohit salunkhe","9503714606","Offline","Eligible","NA","TMK7"
"Shrikrushana bhure","8600718136","Offline","Eligible","NA","TMK7"
"RONAK NAGRALE","9307175914","Offline","Eligible","NA","TMK7"
"UTTAM KADAM","7666870350","Offline","Eligible","NA","TMK7"
"SWARUOOP POKALE","9730980982","Offline","Eligible","NA","TMK7"
"PREMKAMBLE","8237834642","Offline","Ineligible","NA","TMK7"
"LAXMAN AATHAWANE","8263859267","Offline","Eligible","NA","TMK7"
"ASHOK BENKAR","9921213456","Offline","Eligible","NA","TMK7"
"Anuj Mahendra Belapurkar","9028305793","Offline","Eligible","NA","TMK7"
"SADHANA MAURYA","8766924862","Offline","Eligible","NA","TMK7"
"DHEERAJ BIRAMANE","9356791047","Offline","Eligible","NA","TMK7"
"Harish jambhale","8446190573","Offline","Eligible","NA","TMK7"
"umesh shinde","9321878288","Offline","Eligible","NA","TMK7"
"RITESH RAJIWADE","9270204131","Offline","Eligible","NA","TMK7"
"NIKHIL PISAl","7385342018","Offline","Eligible","NA","TMK7"
"GANESH PADWAL","9765550180","Offline","Eligible","NA","TMK7"
"Dipak Dardare","9146133267","Offline","Eligible","NA","TMK7"
"AYUSH KUMBHAR","9637720906","Offline","Eligible","NA","TMK7"
"YUVRAJ CHAVAN","9370479287","Offline","Eligible","NA","TMK7"
"MANGLA PRASAD BHARTI","8795290159","Offline","Eligible","NA","TMK7"
"PRINCE VARMA","9021849390","Offline","Eligible","NA","TMK7"
"ANURUDDH YADAV","7080808405","Offline","Eligible","NA","TMK7"
"PRAKASH DHONDU BAVADHANE","9359558383","Offline","Eligible","NA","TMK7"
"Kunal khatape","9657192498","Offline","Eligible","NA","TMK7"
"AVINASH JADHAV ","7666503186","Offline","Eligible","NA","TMK7"
"GORAKH MALI","9284726346","Offline","Eligible","NA","TMK7"
"KARTIK SHENDGE ","9130050566","Offline","Eligible","NA","TMK7"
"KARTIK CHAVAN","9373455836","Offline","Eligible","NA","TMK7"
"ZAHID HUSSAIN ","9766467824","Offline","Eligible","NA","TMK7"
"Kunal dinesh rajawal","7249165636","Offline","Eligible","NA","TMK7"
"Niraj sanjay gavade","7887823861","Offline","Eligible","NA","TMK7"
"ishwar shirke","7719898779","Offline","Eligible","NA","TMK7"
"HEMANT DHOTRE","8380837650","Offline","Eligible","NA","TMK7"
"RUSHIKESH SUTAR","8446106299","Offline","Eligible","NA","TMK7"
"ABHINANDAN RATHOD","8885325861","Offline","Eligible","NA","TMK7"
"ABHISHEK RATHOD","7350987785","Offline","Eligible","NA","TMK7"
"ANIKET CHAVAN","8904626199","Offline","Eligible","NA","TMK7"
"ADITYA SALUNKHE","8010600766","Offline","Eligible","NA","TMK7"
"ABHISHEK SALAVE","7620091207","Offline","Ineligible","NA","TMK7"
"ANUJ PAWAR","8767539380","Offline","Ineligible","NA","TMK7"
"PRATHAM BIPEPTKAR","7083571919","Offline","Eligible","NA","TMK7"
"DURGADAS SHINDE","9284165260","Offline","Eligible","NA","TMK7"
"SHIDHARTH DAKE","9552911108","Offline","Eligible","NA","TMK7"
"VIRAT PARDESHI","9185100761","Offline","Eligible","NA","TMK7"
"DNYANESHWAR KHUTWAD","9881493889","Offline","Eligible","NA","TMK7"
"LAXMI SHANKAR JADHAV","8329236157","Offline","Eligible","NA","TMK7"
"PRANAV POKALE","9623591819","Offline","Eligible","NA","TMK7"
"VYANKATESH KATE","8856857965","Offline","Eligible","NA","TMK7"
"AAYUSH DHUMAL","9112118839","Offline","Ineligible","NA","TMK7"
"SANA MANSURI","7058202579","Offline","Eligible","NA","TMK7"
"SAGAR PANDIT","9738700900","Offline","Eligible","NA","TMK7"
"SAMSHER CHOUDHARY","9503371346","Offline","Eligible","NA","TMK7"
"ROHIT GOTMUKLE","8788074423","Offline","Eligible","NA","TMK7"`;

describe('Active Riders Service Unit Tests', () => {
  it('normalizes rider names robustly', () => {
    expect(normalizeRiderName('Shubham suresh giri ')).toBe('shubham suresh giri');
    expect(normalizeRiderName('SHUBHAM SURESH GIRI')).toBe('shubham suresh giri');
    expect(normalizeRiderName('  Shubham   Suresh   Giri  ')).toBe('shubham suresh giri');
    expect(normalizeRiderName('')).toBe('');
    expect(normalizeRiderName(null)).toBe('');
  });

  it('parses the sample active riders CSV for TMK7', () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(SAMPLE_CSV).buffer;

    const result = parseActiveRidersFile({
      fileBytes: bytes,
      filename: 'Active_Riders_TMK7.csv',
      targetStoreCode: 'TMK7',
    });

    expect(result.is_valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.valid_riders).toHaveLength(75);
    expect(result.matchedStoreCount).toBe(75);
    expect(result.otherStoreCount).toBe(0);

    // Check first rider
    const first = result.valid_riders[0];
    expect(first.name).toBe('Shubham suresh giri');
    expect(first.normalizedName).toBe('shubham suresh giri');
    expect(first.phone).toBe('9518538846');
    expect(first.onlineStatus).toBe('Offline');
    expect(first.eligibility).toBe('Eligible');
    expect(first.storeCode).toBe('TMK7');

    // Check last rider
    const last = result.valid_riders[74];
    expect(last.name).toBe('ROHIT GOTMUKLE');
    expect(last.normalizedName).toBe('rohit gotmukle');
    expect(last.phone).toBe('8788074423');
  });

  it('rejects files without a Name column', () => {
    const badCsv = `"Phone","Status","Store"\n"9999999999","Online","TMK7"`;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(badCsv).buffer;

    const result = parseActiveRidersFile({
      fileBytes: bytes,
      filename: 'invalid_no_name.csv',
      targetStoreCode: 'TMK7',
    });

    expect(result.is_valid).toBe(false);
    expect(result.errors[0]).toContain('Missing mandatory "Name" column');
  });

  it('correctly identifies active vs inactive riders in roster', () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(SAMPLE_CSV).buffer;

    const result = parseActiveRidersFile({
      fileBytes: bytes,
      filename: 'Active_Riders_TMK7.csv',
      targetStoreCode: 'TMK7',
    });

    const activeSet = new Set(result.valid_riders.map((r) => r.normalizedName));

    // Present in roster with different casing/spacing
    expect(activeSet.has(normalizeRiderName('Shubham suresh giri'))).toBe(true);
    expect(activeSet.has(normalizeRiderName('SHUBHAM SURESH GIRI'))).toBe(true);
    expect(activeSet.has(normalizeRiderName('Satish Swami'))).toBe(true);
    expect(activeSet.has(normalizeRiderName('Rohit Gotmukle'))).toBe(true);

    // Not present in roster
    expect(activeSet.has(normalizeRiderName('John Doe'))).toBe(false);
    expect(activeSet.has(normalizeRiderName('Non Existent Rider'))).toBe(false);
  });

  it('builds phone-by-name map for looking up rider phone numbers', () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(SAMPLE_CSV).buffer;

    const result = parseActiveRidersFile({
      fileBytes: bytes,
      filename: 'Active_Riders_TMK7.csv',
      targetStoreCode: 'TMK7',
    });

    const phoneMap = new Map<string, string>();
    for (const r of result.valid_riders) {
      if (r.phone) {
        phoneMap.set(r.normalizedName, r.phone);
      }
    }

    expect(phoneMap.get(normalizeRiderName('Shubham suresh giri'))).toBe('9518538846');
    expect(phoneMap.get(normalizeRiderName('SHUBHAM SURESH GIRI'))).toBe('9518538846');
    expect(phoneMap.get(normalizeRiderName('Savidhan kisan Wahule'))).toBe('9579835447');
    expect(phoneMap.get(normalizeRiderName('Ganesh shekokar'))).toBe('7219641472');
    expect(phoneMap.get(normalizeRiderName('Non Existent'))).toBeUndefined();
  });
});
