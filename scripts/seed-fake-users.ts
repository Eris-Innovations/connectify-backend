/**
 * Seed ~55 realistic Pakistani girl user accounts for search population.
 *
 * Run from backend/:
 *   npm run seed:users
 *
 * All accounts are:
 *   - isVerified: true          → appear in search immediately
 *   - hasCompletedProfile: true
 *   - role: user
 *   - password: Connectify@2024  (override with SEED_USERS_PASSWORD in .env)
 *
 * Safe to re-run — skips any email/username that already exists.
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectMongo } from '../src/config/db';
import { UserModel } from '../src/modules/users/user.model';

// ─── 55 accounts ─────────────────────────────────────────────────────────────
const FAKE_USERS = [
  // ── Islamabad ──
  { name: 'Sadaf Islamabad',      username: 'sadaf_isb',        city: 'Islamabad',  area: 'F-7'           },
  { name: 'Sadaf ISB',            username: 'sadaff_isb',       city: 'Islamabad',  area: 'PWD'           },
  { name: 'Hira Islamabad',       username: 'hira_isb',         city: 'Islamabad',  area: 'G-9'           },
  { name: 'Nimra Islamabad',      username: 'nimra_isb',        city: 'Islamabad',  area: 'F-10'          },
  { name: 'Zara Islamabad',       username: 'zara_isb',         city: 'Islamabad',  area: 'E-7'           },
  { name: 'Maham Islamabad',      username: 'maham_isb',        city: 'Islamabad',  area: 'I-8'           },
  { name: 'Laiba Islamabad',      username: 'laiba_isb',        city: 'Islamabad',  area: 'Blue Area'     },
  { name: 'Iqra Islamabad',       username: 'iqra_isb',         city: 'Islamabad',  area: 'F-11'          },
  { name: 'Komal Islamabad',      username: 'komal_isb',        city: 'Islamabad',  area: 'Bahria Town'   },

  // ── Lahore / DHA / Gulberg ──
  { name: 'Sara Gulberg',         username: 'sara_gulberg',     city: 'Lahore',     area: 'Gulberg'       },
  { name: 'Nadia DHA',            username: 'nadia_dha',        city: 'Lahore',     area: 'DHA'           },
  { name: 'Aleena DHA',           username: 'aleena_dha',       city: 'Lahore',     area: 'DHA Phase 5'   },
  { name: 'Sana Lahore',          username: 'sana_lahore',      city: 'Lahore',     area: 'Model Town'    },
  { name: 'Fatima Lahore',        username: 'fatima_lahore',    city: 'Lahore',     area: 'Johar Town'    },
  { name: 'Maryam Gulberg',       username: 'maryam_gulberg',   city: 'Lahore',     area: 'Gulberg III'   },
  { name: 'Amna Lahore',          username: 'amna_lahore',      city: 'Lahore',     area: 'Bahria Town'   },
  { name: 'Rabia Lahore',         username: 'rabia_lahore',     city: 'Lahore',     area: 'Garden Town'   },
  { name: 'Hira DHA Lahore',      username: 'hira_dha_lhr',     city: 'Lahore',     area: 'DHA Phase 6'   },
  { name: 'Tooba Lahore',         username: 'tooba_lahore',     city: 'Lahore',     area: 'Wapda Town'    },
  { name: 'Shanza Lahore',        username: 'shanza_lahore',    city: 'Lahore',     area: 'Cantt'         },
  { name: 'Mehak Lahore',         username: 'mehak_lahore',     city: 'Lahore',     area: 'DHA Phase 4'   },

  // ── Karachi ──
  { name: 'Nida Karachi',         username: 'nida_karachi',     city: 'Karachi',    area: 'Clifton'       },
  { name: 'Sobia DHA Karachi',    username: 'sobia_dha_khi',    city: 'Karachi',    area: 'DHA'           },
  { name: 'Areeba Karachi',       username: 'areeba_karachi',   city: 'Karachi',    area: 'Defence'       },
  { name: 'Madiha Karachi',       username: 'madiha_karachi',   city: 'Karachi',    area: 'Gulshan'       },
  { name: 'Sana DHA Karachi',     username: 'sana_dha_khi',     city: 'Karachi',    area: 'DHA Phase 8'   },
  { name: 'Zainab Karachi',       username: 'zainab_karachi',   city: 'Karachi',    area: 'North Nazimabad'},
  { name: 'Alishba Karachi',      username: 'alishba_karachi',  city: 'Karachi',    area: 'Bahria Town'   },
  { name: 'Minahil Karachi',      username: 'minahil_karachi',  city: 'Karachi',    area: 'Clifton Blk 2' },
  { name: 'Rida Karachi',         username: 'rida_karachi',     city: 'Karachi',    area: 'PECHS'         },

  // ── Rawalpindi ──
  { name: 'Amber Rawalpindi',     username: 'amber_rwp',        city: 'Rawalpindi', area: 'Bahria Town'   },
  { name: 'Sadia Rawalpindi',     username: 'sadia_rwp',        city: 'Rawalpindi', area: 'Satellite Town' },
  { name: 'Hifza Rawalpindi',     username: 'hifza_rwp',        city: 'Rawalpindi', area: 'Chaklala'      },
  { name: 'Anum Rawalpindi',      username: 'anum_rwp',         city: 'Rawalpindi', area: 'Cantt'         },

  // ── Faisalabad ──
  { name: 'Faiza Faisalabad',     username: 'faiza_fsd',        city: 'Faisalabad', area: 'Susan Road'    },
  { name: 'Kiran Faisalabad',     username: 'kiran_fsd',        city: 'Faisalabad', area: 'Peoples Colony' },
  { name: 'Ayesha Faisalabad',    username: 'ayesha_fsd',       city: 'Faisalabad', area: 'Gulberg'       },

  // ── Multan ──
  { name: 'Sana Multan',          username: 'sana_multan',      city: 'Multan',     area: 'Cantt'         },
  { name: 'Shaista Multan',       username: 'shaista_multan',   city: 'Multan',     area: 'Bosan Road'    },
  { name: 'Tayyba Multan',        username: 'tayyba_multan',    city: 'Multan',     area: 'Gulgasht'      },

  // ── Peshawar ──
  { name: 'Mehwish Peshawar',     username: 'mehwish_psh',      city: 'Peshawar',   area: 'University Town'},
  { name: 'Rukhsar Peshawar',     username: 'rukhsar_psh',      city: 'Peshawar',   area: 'Hayatabad'     },
  { name: 'Zunaira Peshawar',     username: 'zunaira_psh',      city: 'Peshawar',   area: 'Cantt'         },

  // ── Quetta ──
  { name: 'Sidra Quetta',         username: 'sidra_quetta',     city: 'Quetta',     area: 'Jinnah Town'   },
  { name: 'Huma Quetta',          username: 'huma_quetta',      city: 'Quetta',     area: 'Satellite Town' },

  // ── Hyderabad ──
  { name: 'Amna Hyderabad',       username: 'amna_hyd',         city: 'Hyderabad',  area: 'Latifabad'     },
  { name: 'Noor Hyderabad',       username: 'noor_hyd',         city: 'Hyderabad',  area: 'Qasimabad'     },

  // ── Gujranwala ──
  { name: 'Saba Gujranwala',      username: 'saba_guj',         city: 'Gujranwala', area: 'Model Town'    },
  { name: 'Ayesha Gujranwala',    username: 'ayesha_guj',       city: 'Gujranwala', area: 'Civil Lines'   },

  // ── Sialkot ──
  { name: 'Mishal Sialkot',       username: 'mishal_skt',       city: 'Sialkot',    area: 'Cantt'         },
  { name: 'Jaweria Sialkot',      username: 'jaweria_skt',      city: 'Sialkot',    area: 'Paris Road'    },

  // ── Abbottabad ──
  { name: 'Sahar Abbottabad',     username: 'sahar_abb',        city: 'Abbottabad', area: 'Mandian'       },
  { name: 'Zoya Abbottabad',      username: 'zoya_abb',         city: 'Abbottabad', area: 'Cantt'         },

  // ── Bahawalpur ──
  { name: 'Maira Bahawalpur',     username: 'maira_bwp',        city: 'Bahawalpur', area: 'Model Town'    },

  // ── Generic / Online ──
  { name: 'Aliza Online',         username: 'aliza_online',     city: 'Online',     area: ''              },
];

// ─── Bio templates ────────────────────────────────────────────────────────────
const BIO_TEMPLATES = [
  (area: string, city: string) => `Living my best life in ${area ? area + ', ' : ''}${city} ✨`,
  (_: string, city: string)    => `${city} girl 🌸 | coffee lover ☕`,
  (area: string, city: string) => `Based in ${area || city} | food & travel 🍕✈️`,
  (_: string, city: string)    => `${city} 📍 | just here vibing`,
  (area: string, city: string) => `From ${area ? area + ', ' : ''}${city} | bookworm & foodie 📚`,
  (_: string, city: string)    => `${city} | spreading good vibes only ☀️`,
  (area: string, city: string) => `Hello from ${area || city}! 👋`,
  (_: string, city: string)    => `${city} local 🏙️ | pet lover 🐾`,
  (area: string, city: string) => `${area || city} 💫 | photography & chai`,
  (_: string, city: string)    => `${city} 🌷 | dreamer & doer`,
];

function makeBio(area: string, city: string, index: number): string {
  const fn = BIO_TEMPLATES[index % BIO_TEMPLATES.length];
  return fn(area, city);
}

// ─── Unique phone numbers ─────────────────────────────────────────────────────
function makePhone(index: number): string {
  // +923xx_xxxxxxx — guaranteed unique per index
  const suffix = String(1000000 + index * 13).padStart(7, '0').slice(0, 7);
  const prefix = ['030', '031', '032', '033', '034'][index % 5];
  return `+92${prefix.slice(1)}${suffix}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const password = process.env.SEED_USERS_PASSWORD?.trim() || 'Connectify@2024';

  console.log('🔗 Connecting to MongoDB…');
  await connectMongo();

  const passwordHash = await bcrypt.hash(password, 12);
  console.log(`🔐 Password hashed. Seeding ${FAKE_USERS.length} accounts…\n`);

  let created = 0;
  let skipped = 0;

  for (let i = 0; i < FAKE_USERS.length; i++) {
    const u = FAKE_USERS[i];
    const email = `${u.username}@connectify-user.app`;
    const phone = makePhone(i + 1);

    const exists = await UserModel.findOne({
      $or: [{ email }, { username: u.username }],
    }).lean();

    if (exists) {
      console.log(`  ⏭  SKIP  ${u.name} (@${u.username}) — already exists`);
      skipped++;
      continue;
    }

    await UserModel.create({
      name: u.name,
      username: u.username,
      email,
      phone,
      passwordHash,
      bio: makeBio(u.area, u.city, i),
      isVerified: true,
      hasCompletedProfile: true,
      role: 'user',
      settings: {
        privacy: 'public',
        notificationsEnabled: true,
        messageNotificationsEnabled: true,
        callNotificationsEnabled: true,
        readReceiptsEnabled: true,
        showLastSeen: true,
        theme: 'system',
      },
    });

    console.log(`  ✅ CREATED  ${u.name} (@${u.username})`);
    created++;
  }

  await mongoose.disconnect();
  console.log(`\n🎉 Done!  Created: ${created}  |  Skipped (already existed): ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
