import { QueryInterface } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.bulkInsert(
      "Settings",
      [
        {
          key: "userCreation",
          value: "enabled",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "hoursCloseTicketsAuto",
          value: "9999999999",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "chatBotType",
          value: "text",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "acceptCallWhatsapp",
          value: "enabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "userRandom",
          value: "enabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "sendGreetingMessageOneQueues",
          value: "enabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "sendSignMessage",
          value: "enabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "sendFarewellWaitingTicket",
          value: "enabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "userRating",
          value: "enabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "sendGreetingAccepted",
          value: "enabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "CheckMsgIsGroup",
          value: "enabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "sendQueuePosition",
          value: "enabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "scheduleType",
          value: "enabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "acceptAudioMessageContact",
          value: "enabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "enableLGPD",
          value: "disabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "requiredTag",
          value: "disabled",
          companyId: "1",
          createdAt: new Date(),
          updatedAt: new Date()
        },
      ],
      {}
    );
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.bulkDelete("Settings", {});
  }
};
