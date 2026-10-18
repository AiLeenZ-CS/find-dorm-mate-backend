-- AlterTable
ALTER TABLE `d6_roommate_posts` ADD COLUMN `Booking_ID` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `D6_Roommate_Posts` ADD CONSTRAINT `D6_Roommate_Posts_Booking_ID_fkey` FOREIGN KEY (`Booking_ID`) REFERENCES `D9_Bookings`(`Booking_ID`) ON DELETE SET NULL ON UPDATE CASCADE;
