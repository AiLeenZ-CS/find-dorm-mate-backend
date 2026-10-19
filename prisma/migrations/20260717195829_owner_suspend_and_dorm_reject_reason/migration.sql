-- AlterTable
ALTER TABLE `D2_Owners` ADD COLUMN `Account_Status` VARCHAR(191) NOT NULL DEFAULT 'Active';

-- AlterTable
ALTER TABLE `D3_Dormitories` ADD COLUMN `Admin_Note` TEXT NULL;
