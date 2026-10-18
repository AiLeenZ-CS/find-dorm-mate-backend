-- CreateTable
CREATE TABLE `D5_Facilities` (
    `Facility_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Facility_Name` VARCHAR(100) NOT NULL,
    `Facility_Type` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`Facility_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `D1_Members` (
    `Member_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Profile_Image` VARCHAR(255) NULL,
    `Username` VARCHAR(50) NOT NULL,
    `Email` VARCHAR(100) NOT NULL,
    `Password` VARCHAR(255) NOT NULL,
    `First_Name` VARCHAR(50) NULL,
    `Last_Name` VARCHAR(50) NULL,
    `Nickname` VARCHAR(30) NULL,
    `Gender` VARCHAR(191) NULL,
    `Birthdate` DATE NULL,
    `Phone` VARCHAR(10) NULL,
    `User_Role` VARCHAR(191) NOT NULL DEFAULT 'Member',
    `Account_Status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `Google_ID` VARCHAR(255) NULL,
    `Is_Profile_Completed` BOOLEAN NOT NULL DEFAULT false,
    `Created_At` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Updated_At` DATETIME(3) NOT NULL,

    UNIQUE INDEX `D1_Members_Username_key`(`Username`),
    UNIQUE INDEX `D1_Members_Email_key`(`Email`),
    UNIQUE INDEX `D1_Members_Phone_key`(`Phone`),
    PRIMARY KEY (`Member_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `D2_Identity_Verifications` (
    `Verification_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `ID_Card_No` VARCHAR(13) NULL,
    `ID_Card_Image` VARCHAR(255) NULL,
    `Submitted_Date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Approved_Date` DATETIME(3) NULL,
    `Admin_Note` TEXT NULL,
    `Member_ID` INTEGER NULL,

    PRIMARY KEY (`Verification_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `D3_Dormitories` (
    `Dorm_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Dorm_Name` VARCHAR(150) NOT NULL,
    `Address` TEXT NULL,
    `Ownership_Proof_Image` TEXT NULL,
    `Approval_Status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `Latitude` DECIMAL(10, 8) NULL,
    `Longitude` DECIMAL(11, 8) NULL,
    `Dorm_Type` VARCHAR(191) NULL,
    `Dorm_Images` TEXT NULL,
    `Deposit_Fee` DECIMAL(10, 2) NULL,
    `Insurance_Fee` DECIMAL(10, 2) NULL,
    `Contract_Duration` INTEGER NULL,
    `Is_Pet_Friendly` BOOLEAN NOT NULL DEFAULT false,
    `Is_Smoking_Allowed` BOOLEAN NOT NULL DEFAULT false,
    `Contact_Info` TEXT NULL,
    `Dorm_Status` VARCHAR(191) NOT NULL DEFAULT 'Open',
    `Water_Rate` VARCHAR(50) NULL,
    `Electric_Rate` VARCHAR(50) NULL,
    `Created_At` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Updated_At` DATETIME(3) NOT NULL,
    `Owner_ID` INTEGER NULL,

    PRIMARY KEY (`Dorm_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `D4_Room_Types` (
    `Room_Type_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Room_Type_Name` VARCHAR(255) NULL,
    `Room_Type` VARCHAR(50) NULL,
    `Price_Per_Month` DECIMAL(10, 2) NULL,
    `Total_Rooms` INTEGER NULL,
    `Remaining_Rooms` INTEGER NULL,
    `Room_Images` TEXT NULL,
    `Room_Status` VARCHAR(50) NOT NULL DEFAULT 'Available',
    `Created_At` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Updated_At` DATETIME(3) NOT NULL,
    `Dorm_ID` INTEGER NULL,

    PRIMARY KEY (`Room_Type_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `D6_Roommate_Posts` (
    `Post_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Req_Persons` INTEGER NOT NULL DEFAULT 1,
    `Req_Gender` VARCHAR(50) NULL,
    `Req_Age_Range` VARCHAR(50) NULL,
    `Sleep_Time` VARCHAR(50) NULL,
    `Smoking_Allowed` VARCHAR(50) NULL,
    `Pet_Allowed` VARCHAR(50) NULL,
    `Cleanliness` VARCHAR(50) NULL,
    `Additional_Notes` TEXT NULL,
    `Created_At` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Post_Status` VARCHAR(50) NOT NULL DEFAULT 'Searching',
    `Member_ID` INTEGER NULL,
    `Dorm_ID` INTEGER NULL,
    `Room_Type_ID` INTEGER NULL,

    PRIMARY KEY (`Post_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `D7_Roommate_Matches` (
    `Match_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Match_Status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `Message_To_Owner` TEXT NULL,
    `Response_Date` DATETIME(3) NULL,
    `Requested_At` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Post_ID` INTEGER NULL,
    `Member_ID` INTEGER NULL,

    PRIMARY KEY (`Match_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `D8_Queues` (
    `Queue_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Queue_Number` INTEGER NULL,
    `Queue_Status` VARCHAR(191) NOT NULL DEFAULT 'Waiting',
    `Queued_At` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Start_Time` DATETIME(3) NULL,
    `End_Time` DATETIME(3) NULL,
    `Member_ID` INTEGER NULL,
    `Room_Type_ID` INTEGER NULL,
    `Post_ID` INTEGER NULL,

    PRIMARY KEY (`Queue_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `D9_Bookings` (
    `Booking_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Expected_Move_In` DATE NULL,
    `Note_To_Owner` TEXT NULL,
    `Booking_Status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `Reject_Reason` TEXT NULL,
    `Requested_At` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Response_At` DATETIME(3) NULL,
    `Queue_ID` INTEGER NULL,
    `Member_ID` INTEGER NULL,
    `Dorm_ID` INTEGER NULL,
    `Room_Type_ID` INTEGER NULL,

    PRIMARY KEY (`Booking_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `D10_Reviews` (
    `Review_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Rating` INTEGER NULL,
    `Comment` TEXT NULL,
    `Reviewed_At` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Booking_ID` INTEGER NULL,
    `Member_ID` INTEGER NULL,
    `Dorm_ID` INTEGER NULL,

    PRIMARY KEY (`Review_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `D11_User_Reports` (
    `Report_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Reason` TEXT NULL,
    `Status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `Reported_At` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Closed_At` DATETIME(3) NULL,
    `Reported_User_ID` INTEGER NULL,
    `Booking_ID` INTEGER NULL,
    `Reporter_ID` INTEGER NULL,

    PRIMARY KEY (`Report_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `D12_Chats` (
    `Message_ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Message_Text` TEXT NULL,
    `Is_Read` BOOLEAN NOT NULL DEFAULT false,
    `Sent_At` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `Match_ID` INTEGER NULL,
    `Member_ID` INTEGER NULL,

    PRIMARY KEY (`Message_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_DormToFacility` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_DormToFacility_AB_unique`(`A`, `B`),
    INDEX `_DormToFacility_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_RoomToFacility` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_RoomToFacility_AB_unique`(`A`, `B`),
    INDEX `_RoomToFacility_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `D2_Identity_Verifications` ADD CONSTRAINT `D2_Identity_Verifications_Member_ID_fkey` FOREIGN KEY (`Member_ID`) REFERENCES `D1_Members`(`Member_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D3_Dormitories` ADD CONSTRAINT `D3_Dormitories_Owner_ID_fkey` FOREIGN KEY (`Owner_ID`) REFERENCES `D1_Members`(`Member_ID`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D4_Room_Types` ADD CONSTRAINT `D4_Room_Types_Dorm_ID_fkey` FOREIGN KEY (`Dorm_ID`) REFERENCES `D3_Dormitories`(`Dorm_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D6_Roommate_Posts` ADD CONSTRAINT `D6_Roommate_Posts_Member_ID_fkey` FOREIGN KEY (`Member_ID`) REFERENCES `D1_Members`(`Member_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D6_Roommate_Posts` ADD CONSTRAINT `D6_Roommate_Posts_Dorm_ID_fkey` FOREIGN KEY (`Dorm_ID`) REFERENCES `D3_Dormitories`(`Dorm_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D6_Roommate_Posts` ADD CONSTRAINT `D6_Roommate_Posts_Room_Type_ID_fkey` FOREIGN KEY (`Room_Type_ID`) REFERENCES `D4_Room_Types`(`Room_Type_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D7_Roommate_Matches` ADD CONSTRAINT `D7_Roommate_Matches_Post_ID_fkey` FOREIGN KEY (`Post_ID`) REFERENCES `D6_Roommate_Posts`(`Post_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D7_Roommate_Matches` ADD CONSTRAINT `D7_Roommate_Matches_Member_ID_fkey` FOREIGN KEY (`Member_ID`) REFERENCES `D1_Members`(`Member_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D8_Queues` ADD CONSTRAINT `D8_Queues_Member_ID_fkey` FOREIGN KEY (`Member_ID`) REFERENCES `D1_Members`(`Member_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D8_Queues` ADD CONSTRAINT `D8_Queues_Room_Type_ID_fkey` FOREIGN KEY (`Room_Type_ID`) REFERENCES `D4_Room_Types`(`Room_Type_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D8_Queues` ADD CONSTRAINT `D8_Queues_Post_ID_fkey` FOREIGN KEY (`Post_ID`) REFERENCES `D6_Roommate_Posts`(`Post_ID`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D9_Bookings` ADD CONSTRAINT `D9_Bookings_Queue_ID_fkey` FOREIGN KEY (`Queue_ID`) REFERENCES `D8_Queues`(`Queue_ID`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D9_Bookings` ADD CONSTRAINT `D9_Bookings_Member_ID_fkey` FOREIGN KEY (`Member_ID`) REFERENCES `D1_Members`(`Member_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D9_Bookings` ADD CONSTRAINT `D9_Bookings_Dorm_ID_fkey` FOREIGN KEY (`Dorm_ID`) REFERENCES `D3_Dormitories`(`Dorm_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D9_Bookings` ADD CONSTRAINT `D9_Bookings_Room_Type_ID_fkey` FOREIGN KEY (`Room_Type_ID`) REFERENCES `D4_Room_Types`(`Room_Type_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D10_Reviews` ADD CONSTRAINT `D10_Reviews_Booking_ID_fkey` FOREIGN KEY (`Booking_ID`) REFERENCES `D9_Bookings`(`Booking_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D10_Reviews` ADD CONSTRAINT `D10_Reviews_Member_ID_fkey` FOREIGN KEY (`Member_ID`) REFERENCES `D1_Members`(`Member_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D10_Reviews` ADD CONSTRAINT `D10_Reviews_Dorm_ID_fkey` FOREIGN KEY (`Dorm_ID`) REFERENCES `D3_Dormitories`(`Dorm_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D11_User_Reports` ADD CONSTRAINT `D11_User_Reports_Reported_User_ID_fkey` FOREIGN KEY (`Reported_User_ID`) REFERENCES `D1_Members`(`Member_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D11_User_Reports` ADD CONSTRAINT `D11_User_Reports_Booking_ID_fkey` FOREIGN KEY (`Booking_ID`) REFERENCES `D9_Bookings`(`Booking_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D11_User_Reports` ADD CONSTRAINT `D11_User_Reports_Reporter_ID_fkey` FOREIGN KEY (`Reporter_ID`) REFERENCES `D1_Members`(`Member_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D12_Chats` ADD CONSTRAINT `D12_Chats_Match_ID_fkey` FOREIGN KEY (`Match_ID`) REFERENCES `D7_Roommate_Matches`(`Match_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `D12_Chats` ADD CONSTRAINT `D12_Chats_Member_ID_fkey` FOREIGN KEY (`Member_ID`) REFERENCES `D1_Members`(`Member_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_DormToFacility` ADD CONSTRAINT `_DormToFacility_A_fkey` FOREIGN KEY (`A`) REFERENCES `D3_Dormitories`(`Dorm_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_DormToFacility` ADD CONSTRAINT `_DormToFacility_B_fkey` FOREIGN KEY (`B`) REFERENCES `D5_Facilities`(`Facility_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_RoomToFacility` ADD CONSTRAINT `_RoomToFacility_A_fkey` FOREIGN KEY (`A`) REFERENCES `D4_Room_Types`(`Room_Type_ID`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_RoomToFacility` ADD CONSTRAINT `_RoomToFacility_B_fkey` FOREIGN KEY (`B`) REFERENCES `D5_Facilities`(`Facility_ID`) ON DELETE CASCADE ON UPDATE CASCADE;
