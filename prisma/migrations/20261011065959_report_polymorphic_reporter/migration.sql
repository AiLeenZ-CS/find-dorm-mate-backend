-- DropForeignKey
ALTER TABLE `D11_User_Reports` DROP FOREIGN KEY `D11_User_Reports_Reporter_ID_fkey`;

-- AlterTable
ALTER TABLE `D11_User_Reports` ADD COLUMN `Reporter_Type` VARCHAR(191) NULL;
