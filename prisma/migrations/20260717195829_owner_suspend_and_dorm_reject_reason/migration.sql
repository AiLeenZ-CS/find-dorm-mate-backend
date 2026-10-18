-- AlterTable
ALTER TABLE `d2_owners` ADD COLUMN `Account_Status` VARCHAR(191) NOT NULL DEFAULT 'Active';

-- AlterTable
ALTER TABLE `d3_dormitories` ADD COLUMN `Admin_Note` TEXT NULL;
