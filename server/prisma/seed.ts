import { prisma } from "../src/config/prisma";
import { seedDatabase } from "../src/db/seedDatabase";

seedDatabase()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
