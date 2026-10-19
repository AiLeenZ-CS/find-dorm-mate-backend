/*
  Warnings:

  - You are about to drop the `d2_identity_verifications` table. Its verification fields
    now live directly on the new `D2_Owners` table.
  - Dorm owners are no longer stored in `d1_members`; any existing `User_Role = 'Owner'`
    row is migrated into `D2_Owners` before being removed from `d1_members`.

*/

-- 1. Create the new D2_Owners table first (owners are now fully separate from members)
CREATE TABLE `D2_Owners` (
    `Owner_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Profile_Image` VARCHAR(255) NULL,
    `Username` VARCHAR(50) NOT NULL,
    `Email` VARCHAR(100) NOT NULL,
    `Password` VARCHAR(255) NOT NULL,
    `First_Name` VARCHAR(50) NULL,
    `Last_Name` VARCHAR(50) NULL,
    `ID_Card_No` VARCHAR(13) NULL,
    `ID_Card_Image` VARCHAR(255) NULL,
    `Phone` VARCHAR(10) NULL,
    `Submitted_Date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Approved_Date` DATETIME(3) NULL,
    `Admin_Note` TEXT NULL,
    `Status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `Google_ID` VARCHAR(255) NULL,

    UNIQUE INDEX `D2_Owners_Username_key`(`Username`),
    UNIQUE INDEX `D2_Owners_Email_key`(`Email`),
    UNIQUE INDEX `D2_Owners_Phone_key`(`Phone`),
    PRIMARY KEY (`Owner_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. Carry over any existing Owner-role members' data into the new table
INSERT INTO `D2_Owners` (`Profile_Image`, `Username`, `Email`, `Password`, `First_Name`, `Last_Name`, `Phone`, `Google_ID`, `Status`)
SELECT `Profile_Image`, `Username`, `Email`, `Password`, `First_Name`, `Last_Name`, `Phone`, `Google_ID`, 'Pending'
FROM `D1_Members`
WHERE `User_Role` = 'Owner';

-- 3. Drop the old identity-verification table (superseded by D2_Owners' own fields)
ALTER TABLE `D2_Identity_Verifications` DROP FOREIGN KEY `D2_Identity_Verifications_Member_ID_fkey`;
DROP TABLE `D2_Identity_Verifications`;

-- 4. Re-point Dormitories.Owner_ID from the old Member_ID to the newly created Owner_ID
ALTER TABLE `D3_Dormitories` DROP FOREIGN KEY `D3_Dormitories_Owner_ID_fkey`;

UPDATE `D3_Dormitories` d
JOIN `D1_Members` m ON d.Owner_ID = m.Member_ID AND m.User_Role = 'Owner'
JOIN `D2_Owners` o ON o.Email = m.Email
SET d.Owner_ID = o.Owner_ID;

ALTER TABLE `D3_Dormitories` ADD CONSTRAINT `D3_Dormitories_Owner_ID_fkey` FOREIGN KEY (`Owner_ID`) REFERENCES `D2_Owners`(`Owner_ID`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Remove the now-migrated Owner-role rows from Members (Members table is Member/Admin only from here on)
DELETE FROM `D1_Members` WHERE `User_Role` = 'Owner';
