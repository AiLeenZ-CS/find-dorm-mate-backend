-- DropIndex
DROP INDEX `D11_User_Reports_Reporter_ID_fkey` ON `D11_User_Reports`;

-- CreateTable
CREATE TABLE `D14_Device_Tokens` (
    `Token_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Recipient_Type` VARCHAR(191) NOT NULL,
    `Recipient_ID` INTEGER NOT NULL,
    `FCM_Token` VARCHAR(255) NOT NULL,
    `Platform` VARCHAR(20) NULL,
    `Created_At` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Updated_At` DATETIME(3) NOT NULL,

    UNIQUE INDEX `D14_Device_Tokens_FCM_Token_key`(`FCM_Token`),
    INDEX `D14_Device_Tokens_Recipient_Type_Recipient_ID_idx`(`Recipient_Type`, `Recipient_ID`),
    PRIMARY KEY (`Token_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
