-- CreateTable
CREATE TABLE `D13_Notifications` (
    `Notification_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Recipient_Type` VARCHAR(191) NOT NULL,
    `Recipient_ID` INTEGER NOT NULL,
    `Type` VARCHAR(191) NOT NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Body` TEXT NULL,
    `Link` VARCHAR(255) NULL,
    `Is_Read` BOOLEAN NOT NULL DEFAULT false,
    `Created_At` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `D13_Notifications_Recipient_Type_Recipient_ID_Is_Read_idx`(`Recipient_Type`, `Recipient_ID`, `Is_Read`),
    PRIMARY KEY (`Notification_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
