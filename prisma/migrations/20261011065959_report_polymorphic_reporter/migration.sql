-- DropForeignKey
ALTER TABLE `d11_user_reports` DROP FOREIGN KEY `D11_User_Reports_Reporter_ID_fkey`;

-- AlterTable
ALTER TABLE `d11_user_reports` ADD COLUMN `Reporter_Type` VARCHAR(191) NULL;
