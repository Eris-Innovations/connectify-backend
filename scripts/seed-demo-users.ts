import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { connectMongo } from '../src/config/db';
import { UserModel } from '../src/modules/users/user.model';

type DemoUserSeed = {
  name: string;
  username: string;
  email: string;
  phone: string;
  bio: string;
};

const DEMO_PASSWORD = process.env.SEED_DEMO_USERS_PASSWORD?.trim() || 'Connectify@123';
const ALLOW_PRODUCTION = process.env.SEED_DEMO_USERS_CONFIRM === 'yes';

const DEMO_USERS: DemoUserSeed[] = [
  ['Ali Raza', 'ali.raza', 'Karachi based product designer who likes voice notes more than long texts.', '+923001234501'],
  ['Ayesha Khan', 'ayesha.khan', 'Lahore entrepreneur, coffee lover, and always online after Maghrib.', '+923011234502'],
  ['Hamza Ahmed', 'hamza.ahmed', 'Islamabad founder building small tools for big everyday problems.', '+923021234503'],
  ['Fatima Noor', 'fatima.noor', 'UX researcher from Faisalabad who loves thoughtful conversations.', '+923031234504'],
  ['Bilal Hussain', 'bilal.hussain', 'Cricket, chai, and clean code. In that order on weekends.', '+923041234505'],
  ['Zainab Iqbal', 'zainab.iqbal', 'Content strategist from Multan with a soft spot for calm communities.', '+923051234506'],
  ['Usman Tariq', 'usman.tariq', 'Frontend engineer from Rawalpindi. Fast replies, slower mornings.', '+923061234507'],
  ['Maryam Javed', 'maryam.javed', 'Medical student in Peshawar sharing notes, memes, and late night updates.', '+923071234508'],
  ['Abdullah Sheikh', 'abdullah.sheikh', 'Supply chain operator from Sialkot who prefers audio over typing.', '+923081234509'],
  ['Hira Malik', 'hira.malik', 'Brand manager in Karachi. Usually active after office hours.', '+923091234510'],
  ['Saad Qureshi', 'saad.qureshi', 'Marketing lead from Hyderabad with a habit of replying instantly.', '+923101234511'],
  ['Mahnoor Aslam', 'mahnoor.aslam', 'Teacher from Gujranwala, here for meaningful chats and community.', '+923111234512'],
  ['Talha Siddiqui', 'talha.siddiqui', 'Sports fan, Android user, and regular tester of new chat features.', '+923121234513'],
  ['Laiba Imran', 'laiba.imran', 'Student creator from Lahore who shares photos, reels, and random thoughts.', '+923131234514'],
  ['Muneeb Farooq', 'muneeb.farooq', 'Operations specialist from Karachi. Clear messages, no drama.', '+923141234515'],
  ['Iqra Saleem', 'iqra.saleem', 'Fashion entrepreneur from Bahawalpur with quick replies and warm energy.', '+923151234516'],
  ['Daniyal Rehman', 'daniyal.rehman', 'Developer from Islamabad who prefers neat inboxes and faster calls.', '+923161234517'],
  ['Noor Fatima', 'noor.fatima', 'Community moderator from Quetta keeping conversations respectful.', '+923171234518'],
  ['Ahmad Waqar', 'ahmad.waqar', 'E-commerce operator from Lahore, active during business hours.', '+923181234519'],
  ['Eman Zahid', 'eman.zahid', 'HR lead from Karachi who likes polished profiles and simple UIs.', '+923191234520'],
  ['Sameer Haider', 'sameer.haider', 'Startup operator in Islamabad sharing product ideas and feedback.', '+923201234521'],
  ['Komal Bano', 'komal.bano', 'Journalism student from Sukkur with a love for group chats.', '+923211234522'],
  ['Shahzaib Ali', 'shahzaib.ali', 'Mobile repair shop owner from Kasur. Replies mostly with voice notes.', '+923221234523'],
  ['Anaya Faisal', 'anaya.faisal', 'Lifestyle blogger from Lahore who likes clean, friendly spaces.', '+923231234524'],
  ['Taimoor Khalid', 'taimoor.khalid', 'Sales manager in Karachi, often testing notifications on multiple phones.', '+923241234525'],
  ['Rabia Anjum', 'rabia.anjum', 'University lecturer from Sahiwal. Practical, kind, and detail oriented.', '+923251234526'],
  ['Huzaifa Nadeem', 'huzaifa.nadeem', 'Support engineer from Rawalpindi who notices every edge case.', '+923261234527'],
  ['Mehak Rauf', 'mehak.rauf', 'Photographer in Lahore sharing albums and behind-the-scenes moments.', '+923271234528'],
  ['Farhan Latif', 'farhan.latif', 'Freelancer from Karachi balancing clients, calls, and cricket streams.', '+923281234529'],
  ['Areeba Tariq', 'areeba.tariq', 'Designer from Islamabad focused on calm colors and tidy layouts.', '+923291234530'],
  ['Shayan Butt', 'shayan.butt', 'Restaurant owner from Gujrat who checks messages between lunch rushes.', '+923301234531'],
  ['Maham Saeed', 'maham.saeed', 'Psychology student from Peshawar who values private conversations.', '+923311234532'],
  ['Rayan Yousaf', 'rayan.yousaf', 'Videographer from Karachi sending lots of media and status updates.', '+923321234533'],
  ['Sania Arif', 'sania.arif', 'Small business owner in Multan, usually active in the evenings.', '+923331234534'],
  ['Waqar Abbas', 'waqar.abbas', 'Logistics planner from Faisalabad with a very organized contact list.', '+923341234535'],
  ['Minal Tariq', 'minal.tariq', 'Law student from Lahore who prefers text over missed calls.', '+923451234536'],
  ['Omer Faraz', 'omer.faraz', 'Product analyst in Islamabad. Loves data, hates dropped calls.', '+923461234537'],
  ['Zoya Saqlain', 'zoya.saqlain', 'Writer from Karachi, usually found in late-night conversations.', '+923471234538'],
  ['Hasnain Mir', 'hasnain.mir', 'University athlete from Sargodha sharing team chats and updates.', '+923481234539'],
  ['Amna Yasin', 'amna.yasin', 'Community builder from Lahore who likes welcoming new people.', '+923491234540'],
].map(([name, username, bio, phone]) => ({
  name,
  username,
  bio,
  phone,
  email: `${username.replace(/\./g, '')}@connectify-demo.pk`,
}));

async function main() {
  if (env.NODE_ENV === 'production' && !ALLOW_PRODUCTION) {
    console.error('Refusing to seed demo users in production without SEED_DEMO_USERS_CONFIRM=yes');
    process.exit(1);
  }

  await connectMongo();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  let created = 0;
  let updated = 0;

  for (const demoUser of DEMO_USERS) {
    const existing = await UserModel.findOne({
      $or: [{ email: demoUser.email }, { username: demoUser.username }, { phone: demoUser.phone }],
    });

    if (existing) {
      existing.name = demoUser.name;
      existing.username = demoUser.username;
      existing.email = demoUser.email;
      existing.phone = demoUser.phone;
      existing.bio = demoUser.bio;
      existing.passwordHash = passwordHash;
      existing.isVerified = true;
      existing.hasCompletedProfile = true;
      existing.region = 'apac';
      await existing.save();
      updated += 1;
      continue;
    }

    await UserModel.create({
      name: demoUser.name,
      username: demoUser.username,
      email: demoUser.email,
      phone: demoUser.phone,
      bio: demoUser.bio,
      passwordHash,
      isVerified: true,
      hasCompletedProfile: true,
      region: 'apac',
    });
    created += 1;
  }

  console.log(`Demo users ready. Created: ${created}, updated: ${updated}, total configured: ${DEMO_USERS.length}`);
  console.log(`Shared password for demo users: ${DEMO_PASSWORD}`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect failure on crash path
  }
  process.exit(1);
});
