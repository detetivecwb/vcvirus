
import path, { join } from "path";
import { promisify } from "util";
import { readFile, writeFile } from "fs";
import fs from "fs";
import * as Sentry from "@sentry/node";
import { isNil, isNull } from "lodash";

import {
  downloadMediaMessage,
  extractMessageContent,
  getContentType,
  GroupMetadata,
  jidNormalizedUser,
  delay,
  MessageUpsertType,
  proto,
  WAMessage,
  WAMessageStubType,
  WAMessageUpdate,
  WASocket
} from "@whiskeysockets/baileys";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";

import { getIO } from "../../libs/socket";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { logger } from "../../utils/logger";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import { debounce } from "../../helpers/Debounce";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import formatBody from "../../helpers/Mustache";
import TicketTraking from "../../models/TicketTraking";
import UserRating from "../../models/UserRating";
import SendWhatsAppMessage from "./SendWhatsAppMessage";
import sendFaceMessage from "../FacebookServices/sendFacebookMessage";
import moment from "moment";
import Queue from "../../models/Queue";
import FindOrCreateATicketTrakingService from "../TicketServices/FindOrCreateATicketTrakingService";
import VerifyCurrentSchedule from "../CompanyService/VerifyCurrentSchedule";
import Campaign from "../../models/Campaign";
import CampaignShipping from "../../models/CampaignShipping";
import { Op } from "sequelize";
import { campaignQueue, parseToMilliseconds, randomValue } from "../../queues";
import User from "../../models/User";
import { sayChatbot } from "./ChatBotListener";
import MarkDeleteWhatsAppMessage from "./MarkDeleteWhatsAppMessage";
import ListUserQueueServices from "../UserQueueServices/ListUserQueueServices";
import cacheLayer from "../../libs/cache";
import { addLogs } from "../../helpers/addLogs";
import { getMessageOptions } from "./SendWhatsAppMedia";

import ShowQueueIntegrationService from "../QueueIntegrationServices/ShowQueueIntegrationService";
import { createDialogflowSessionWithModel } from "../QueueIntegrationServices/CreateSessionDialogflow";
import { queryDialogFlow } from "../QueueIntegrationServices/QueryDialogflow";
import CompaniesSettings from "../../models/CompaniesSettings";
import CreateLogTicketService from "../TicketServices/CreateLogTicketService";
import pino from "pino";

const request = require("request");

let i = 0;

setInterval(() => {
  i = 0
}, 5000);

type Session = WASocket & {
  id?: number;
};

interface ImessageUpsert {
  messages: proto.IWebMessageInfo[];
  type: MessageUpsertType;
}

interface IMe {
  name: string;
  id: string;
}

const writeFileAsync = promisify(writeFile);

function removeFile(directory) {
  fs.unlink(directory, (error) => {
    if (error) throw error;
  });
}

const getTimestampMessage = (msgTimestamp: any) => {
  return msgTimestamp * 1
}

const multVecardGet = function (param: any) {
  let output = " "

  let name = param.split("\n")[2].replace(";;;", "\n").replace('N:', "").replace(";", "").replace(";", " ").replace(";;", " ").replace("\n", "")
  let inicio = param.split("\n")[4].indexOf('=')
  let fim = param.split("\n")[4].indexOf(':')
  let contact = param.split("\n")[4].substring(inicio + 1, fim).replace(";", "")
  let contactSemWhats = param.split("\n")[4].replace("item1.TEL:", "")
  //console.log(contact);
  if (contact != "item1.TEL") {
    output = output + name + ": 📞" + contact + "" + "\n"
  } else
    output = output + name + ": 📞" + contactSemWhats + "" + "\n"
  return output
}

const contactsArrayMessageGet = (msg: any,) => {
  let contactsArray = msg.message?.contactsArrayMessage?.contacts
  let vcardMulti = contactsArray.map(function (item, indice) {
    return item.vcard;
  });

  let bodymessage = ``
  vcardMulti.forEach(function (vcard, indice) {
    bodymessage += vcard + "\n\n" + ""
  })

  let contacts = bodymessage.split("BEGIN:")

  contacts.shift()
  let finalContacts = ""
  for (let contact of contacts) {
    finalContacts = finalContacts + multVecardGet(contact)
  }

  return finalContacts
}

const getTypeMessage = (msg: proto.IWebMessageInfo): string => {
  const msgType = getContentType(msg.message);
  if (msg.message?.viewOnceMessageV2) {
    return "viewOnceMessageV2"
  }
  return msgType
};

// const getBodyButton = (msg: proto.IWebMessageInfo): string => {
//   if (msg.key.fromMe && msg?.message?.buttonsMessage?.contentText) {
//     let bodyMessage = `*${msg?.message?.buttonsMessage?.contentText}*`;
//     // eslint-disable-next-line no-restricted-syntax
//     for (const buton of msg.message?.buttonsMessage?.buttons) {
//       bodyMessage += `\n\n${buton.buttonText?.displayText}`;
//     }
//     return bodyMessage;
//   }

//   if (msg.key.fromMe && msg?.message?.listMessage) {
//     let bodyMessage = `*${msg?.message?.listMessage?.description}*`;
//     // eslint-disable-next-line no-restricted-syntax
//     for (const buton of msg.message?.listMessage?.sections) {
//       for (const rows of buton.rows) {
//         bodyMessage += `\n\n${rows.title}`;
//       }
//     }

//     return bodyMessage;
//   }
//   if (msg.key.fromMe && msg?.message?.viewOnceMessage?.message?.listMessage) {
//     let bodyMessage = `*${msg?.message?.viewOnceMessage?.message?.listMessage?.description}*`;
//     // eslint-disable-next-line no-restricted-syntax
//     for (const buton of msg?.message?.viewOnceMessage?.message?.listMessage
//       ?.sections) {
//       for (const rows of buton.rows) {
//         bodyMessage += `\n\n${rows.title}`;
//       }
//     }

//     return bodyMessage;
//   }
//   if (
//     msg.key.fromMe &&
//     msg?.message?.viewOnceMessage?.message?.buttonsMessage
//   ) {
//     let bodyMessage = `*${msg?.message?.viewOnceMessage?.message?.buttonsMessage?.contentText}*`;
//     // eslint-disable-next-line no-restricted-syntax
//     for (const buton of msg?.message?.viewOnceMessage?.message?.buttonsMessage
//       ?.buttons) {
//       bodyMessage += `\n\n${buton.buttonText?.displayText}`;
//     }

//     return bodyMessage;
//   }
// };

const getBodyButton = (msg: proto.IWebMessageInfo): string => {
  if (msg.key.fromMe && msg.message.buttonsMessage?.contentText) {
    let bodyMessage = `${msg?.message?.buttonsMessage?.contentText}`;

    for (const buton of msg.message?.buttonsMessage?.buttons) {
      bodyMessage += `\n\n${buton.buttonText?.displayText}`;
    }
    return bodyMessage;
  }

  if (msg.key.fromMe && msg?.message?.viewOnceMessage?.message?.listMessage) {
    let bodyMessage = `${msg?.message?.viewOnceMessage?.message?.listMessage?.description}`;
    for (const buton of msg.message?.viewOnceMessage?.message?.listMessage?.sections) {
      for (const rows of buton.rows) {
        bodyMessage += `\n\n${rows.title}`;
      }
    }

    return bodyMessage;
  }
};

const getBodyList = (msg: proto.IWebMessageInfo): string => {
  if (msg.key.fromMe && msg.message.listMessage?.description) {
    let bodyMessage = `${msg.message.listMessage?.description}`;
    for (const buton of msg.message.listMessage?.sections) {
      for (const rows of buton.rows) {
        bodyMessage += `\n\n${rows.title}`;
      }
    }
    return bodyMessage;
  }

  if (msg.key.fromMe && msg?.message?.viewOnceMessage?.message?.listMessage) {
    let bodyMessage = `${msg?.message?.viewOnceMessage?.message?.listMessage?.description}`;
    for (const buton of msg.message?.viewOnceMessage?.message?.listMessage?.sections) {
      for (const rows of buton.rows) {
        bodyMessage += `\n\n${rows.title}`;
      }
    }

    return bodyMessage;
  }
};


const getAd = (msg: proto.IWebMessageInfo): string => {
  if (msg.key.fromMe && msg.message?.listResponseMessage?.contextInfo?.externalAdReply) {
    let bodyMessage = `*${msg.message?.listResponseMessage?.contextInfo?.externalAdReply?.title}*`;

    bodyMessage += `\n\n${msg.message?.listResponseMessage?.contextInfo?.externalAdReply?.body}`;

    return bodyMessage;
  }
};


const getviewOnceMessage = (msg: proto.IWebMessageInfo): string => {
  if (
    msg.key.fromMe &&
    msg?.message?.viewOnceMessage?.message?.buttonsMessage?.contentText
  ) {
    let bodyMessage = `*${msg?.message?.viewOnceMessage?.message?.buttonsMessage?.contentText}*`;
    // eslint-disable-next-line no-restricted-syntax
    for (const buton of msg.message?.viewOnceMessage?.message?.buttonsMessage?.buttons) {
      console.log('buton', buton);
      bodyMessage += `\n\n${buton.buttonText?.displayText}`;
    }
    return bodyMessage;
  }

  if (msg.key.fromMe && msg?.message?.viewOnceMessage?.message?.listMessage) {
    let bodyMessage = `*${msg?.message?.viewOnceMessage?.message?.listMessage?.description}*`;
    // eslint-disable-next-line no-restricted-syntax
    for (const buton of msg.message?.viewOnceMessage?.message?.listMessage
      ?.sections) {
      // eslint-disable-next-line no-restricted-syntax
      for (const rows of buton.rows) {
        bodyMessage += `\n\n${rows.title}`;
      }
    }

    return bodyMessage;
  }
};


const msgLocation = (image, latitude, longitude) => {
  if (image) {
    var b64 = Buffer.from(image).toString("base64");

    let data = `data:image/png;base64, ${b64} | https://maps.google.com/maps?q=${latitude}%2C${longitude}&z=17&hl=pt-BR|${latitude}, ${longitude} `;
    return data;
  }
};

export const getBodyMessage = (msg: proto.IWebMessageInfo): string | null => {
  try {
    let type = getTypeMessage(msg);

    const types = {
      conversation: msg.message?.conversation,
      imageMessage: msg.message?.imageMessage?.caption,
      videoMessage: msg.message?.videoMessage?.caption,
      extendedTextMessage: msg.message?.extendedTextMessage?.text,
      buttonsResponseMessage: msg.message?.buttonsResponseMessage?.selectedDisplayText,
      listResponseMessage: msg.message?.listResponseMessage?.title || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId,
      templateButtonReplyMessage: msg.message?.templateButtonReplyMessage?.selectedId,
      messageContextInfo: msg.message?.buttonsResponseMessage?.selectedButtonId || msg.message?.listResponseMessage?.title,
      buttonsMessage: getBodyButton(msg) || msg.message?.listResponseMessage?.title,
      stickerMessage: "sticker",
      contactMessage: msg.message?.contactMessage?.vcard,
      contactsArrayMessage: (msg.message?.contactsArrayMessage?.contacts) && contactsArrayMessageGet(msg),
      locationMessage: msgLocation(msg.message?.locationMessage?.jpegThumbnail, msg.message?.locationMessage?.degreesLatitude, msg.message?.locationMessage?.degreesLongitude),
      liveLocationMessage: `Latitude: ${msg.message?.liveLocationMessage?.degreesLatitude} - Longitude: ${msg.message?.liveLocationMessage?.degreesLongitude}`,
      documentMessage: msg.message?.documentMessage?.title,
      audioMessage: "Áudio",
      listMessage: getBodyList(msg) || msg.message?.listResponseMessage?.title,
      viewOnceMessage: getviewOnceMessage(msg) || msg.message?.listResponseMessage?.title,
      reactionMessage: msg.message?.reactionMessage?.text || "reaction",
      senderKeyDistributionMessage: msg?.message?.senderKeyDistributionMessage?.axolotlSenderKeyDistributionMessage,
      documentWithCaptionMessage: msg.message?.documentWithCaptionMessage?.message?.documentMessage?.caption,
      viewOnceMessageV2: msg.message?.viewOnceMessageV2?.message?.imageMessage?.caption,
      editedMessage: msg?.message?.protocolMessage?.editedMessage?.conversation || msg?.message?.editedMessage?.message?.protocolMessage?.editedMessage?.conversation,
      ephemeralMessage: msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text,
      advertising: getAd(msg) || msg.message?.listResponseMessage?.contextInfo?.externalAdReply?.title,
      imageWhitCaptionMessage: msg?.message?.ephemeralMessage?.message?.imageMessage,
      highlyStructuredMessage: msg.message?.highlyStructuredMessage,
      protocolMessage: msg?.message?.protocolMessage?.editedMessage?.conversation
    };

    const objKey = Object.keys(types).find(key => key === type);

    if (!objKey) {
      logger.warn(`#### Nao achou o type 152: ${type}
${JSON.stringify(msg)}`);
      Sentry.setExtra("Mensagem", { BodyMsg: msg.message, msg, type });
      Sentry.captureException(
        new Error("Novo Tipo de Mensagem em getTypeMessage")
      );
    }
    return types[type];
  } catch (error) {
    Sentry.setExtra("Error getTypeMessage", { msg, BodyMsg: msg.message });
    Sentry.captureException(error);
    console.log(error);
  }
};

export const getQuotedMessage = (msg: proto.IWebMessageInfo) => {
  const body = extractMessageContent(msg.message)[
    Object.keys(msg?.message).values().next().value
  ];

  if (!body?.contextInfo?.quotedMessage) return;
  const quoted = extractMessageContent(
    body?.contextInfo?.quotedMessage[
    Object.keys(body?.contextInfo?.quotedMessage).values().next().value
    ]
  );

  return quoted;
};

export const getQuotedMessageId = (msg: proto.IWebMessageInfo) => {
  const body = extractMessageContent(msg.message)[
    Object.keys(msg?.message).values().next().value
  ];
  let reaction = msg?.message?.reactionMessage
    ? msg?.message?.reactionMessage?.key?.id
    : "";

  return reaction ? reaction : body?.contextInfo?.stanzaId;
};

const getMeSocket = (wbot: Session): IMe => {
  return {
    id: jidNormalizedUser((wbot as WASocket).user.id),
    name: (wbot as WASocket).user.name
  }
};

const getSenderMessage = (
  msg: proto.IWebMessageInfo,
  wbot: Session
): string => {
  const me = getMeSocket(wbot);
  if (msg.key.fromMe) return me.id;

  const senderId =
    msg.participant || msg.key.participant || msg.key.remoteJid || undefined;

  return senderId && jidNormalizedUser(senderId);
};

const getContactMessage = async (msg: proto.IWebMessageInfo, wbot: Session) => {
  const isGroup = msg.key.remoteJid.includes("g.us");
  const rawNumber = msg.key.remoteJid.replace(/\D/g, "");
  return isGroup
    ? {
      id: getSenderMessage(msg, wbot),
      name: msg.pushName
    }
    : {
      id: msg.key.remoteJid,
      name: msg.key.fromMe ? rawNumber : msg.pushName
    };
};

const downloadMedia = async (msg: proto.IWebMessageInfo, isImported: Date = null, wbot: Session) => {

  if (msg.message?.stickerMessage) {
    const urlAnt = "https://web.whatsapp.net";
    const directPath = msg.message?.stickerMessage?.directPath;
    const newUrl = "https://mmg.whatsapp.net";

    const final = newUrl + directPath;

    if (msg.message?.stickerMessage.url.includes(urlAnt)) {
      msg.message.stickerMessage.url = msg.message?.stickerMessage.url.replace(urlAnt, final);
    }
  }

  let buffer
  try {
    buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {
        options: {
          lookup(hostname, options, cb) {
            cb(null, '157.240.216.60', 4);
          },
        },
      },
      {
        logger,
        reuploadRequest: (msg) => wbot.updateMediaMessage(msg), // Adjusted to be a function
      }
    )
  } catch (err) {
    try {
      buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {
          options: {
            lookup(hostname, options, cb) {
              cb(null, '157.240.12.53', 4);
            },
          },
        },
        {
          reuploadRequest: (msg) => wbot.updateMediaMessage(msg), // Adjusted to be a function
          logger: pino({ level: 'debug' }).child({
            class: 'DownloadMediaMessage',
          }),
        }
      )
    }
    catch (err2) {
      if (isImported) {
        console.log("Falha ao fazer o download de uma mensagem importada, provavelmente a mensagem já não esta mais disponível")
      } else {
        console.error('Erro ao baixar mídia:', err);
      }
    }
    // Trate o erro de acordo com as suas necessidades
  }

  let filename = msg.message?.documentMessage?.fileName || "";

  const mineType =
    msg.message?.imageMessage ||
    msg.message?.audioMessage ||
    msg.message?.videoMessage ||
    msg.message?.stickerMessage ||
    msg.message?.documentMessage ||
    msg.message?.documentWithCaptionMessage?.message?.documentMessage ||
    msg.message?.ephemeralMessage?.message?.audioMessage ||
    msg.message?.ephemeralMessage?.message?.documentMessage ||
    msg.message?.ephemeralMessage?.message?.videoMessage ||
    msg.message?.ephemeralMessage?.message?.stickerMessage ||
    msg.message?.ephemeralMessage?.message?.imageMessage ||
    msg.message?.viewOnceMessage?.message?.imageMessage ||
    msg.message?.viewOnceMessage?.message?.videoMessage ||
    msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.imageMessage ||
    msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.videoMessage ||
    msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.audioMessage ||
    msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.documentMessage ||
    msg.message?.documentWithCaptionMessage?.message?.documentMessage ||
    msg.message?.templateMessage?.hydratedTemplate?.imageMessage ||
    msg.message?.templateMessage?.hydratedTemplate?.documentMessage ||
    msg.message?.templateMessage?.hydratedTemplate?.videoMessage ||
    msg.message?.templateMessage?.hydratedFourRowTemplate?.imageMessage ||
    msg.message?.templateMessage?.hydratedFourRowTemplate?.documentMessage ||
    msg.message?.templateMessage?.hydratedFourRowTemplate?.videoMessage ||
    msg.message?.templateMessage?.fourRowTemplate?.imageMessage ||
    msg.message?.templateMessage?.fourRowTemplate?.documentMessage ||
    msg.message?.templateMessage?.fourRowTemplate?.videoMessage ||
    msg.message?.interactiveMessage?.header?.imageMessage ||
    msg.message?.interactiveMessage?.header?.documentMessage ||
    msg.message?.interactiveMessage?.header?.videoMessage

  if (!mineType)
    console.log(msg)

  if (!filename) {
    const ext = mineType.mimetype.split("/")[1].split(";")[0];
    filename = `${new Date().getTime()}.${ext}`;
  } else {
    filename = `${new Date().getTime()}_${filename}`;
  }

  const media = {
    data: buffer,
    mimetype: mineType.mimetype,
    filename
  };

  return media;
}

const verifyContact = async (
  msgContact: IMe,
  wbot: Session,
  companyId: number
): Promise<Contact> => {

  let profilePicUrl: string;
  try {
    profilePicUrl = await wbot.profilePictureUrl(msgContact.id, "image");
  } catch (e) {
    Sentry.captureException(e);
    profilePicUrl = `${process.env.FRONTEND_URL}/nopicture.png`;
  }

  const contactData = {
    name: msgContact.name || msgContact.id.replace(/\D/g, ""),
    number: msgContact.id.replace(/\D/g, ""),
    profilePicUrl,
    isGroup: msgContact.id.includes("g.us"),
    companyId,
    remoteJid: msgContact.id
  };

  if (contactData.isGroup) {
    contactData.number = msgContact.id.replace("@g.us", "");
  }

  const contact = CreateOrUpdateContactService(contactData);

  return contact;
};

const verifyQuotedMessage = async (
  msg: proto.IWebMessageInfo
): Promise<Message | null> => {
  if (!msg) return null;
  const quoted = getQuotedMessageId(msg);

  if (!quoted) return null;

  const quotedMsg = await Message.findOne({
    where: { wid: quoted }
  });

  if (!quotedMsg) return null;

  return quotedMsg;
};

export const verifyMediaMessage = async (
  msg: proto.IWebMessageInfo,
  ticket: Ticket,
  contact: Contact,
  ticketTraking?: TicketTraking,
  isForwarded?: boolean,
  wbot?: Session
): Promise<Message> => {
  const io = getIO();
  const quotedMsg = await verifyQuotedMessage(msg);
  try {
    const media = await downloadMedia(msg, ticket?.imported, wbot);
    if (!media && ticket.imported) {
      const body =
        "*System:* \nFalha no download da mídia verifique no dispositivo";
      const messageData = {
        //mensagem de texto
        wid: msg.key.id,
        ticketId: ticket.id,
        contactId: msg.key.fromMe ? undefined : ticket.contactId,
        body,
        reactionMessage: msg.message?.reactionMessage,
        fromMe: msg.key.fromMe,
        mediaType: getTypeMessage(msg),
        read: msg.key.fromMe,
        quotedMsgId: quotedMsg?.id || msg.message?.reactionMessage?.key?.id,
        ack: msg.status,
        companyId: ticket.companyId,
        remoteJid: msg.key.remoteJid,
        participant: msg.key.participant,
        timestamp: getTimestampMessage(msg.messageTimestamp),
        createdAt: new Date(
          Math.floor(getTimestampMessage(msg.messageTimestamp) * 1000)
        ).toISOString(),
        dataJson: JSON.stringify(msg),
        ticketImported: ticket.imported,
        isForwarded
      };

      await ticket.update({
        lastMessage: body
      });
      logger.error(Error("ERR_WAPP_DOWNLOAD_MEDIA"));
      return CreateMessageService({ messageData, companyId: ticket.companyId });
    }

    if (!media) {
      throw new Error("ERR_WAPP_DOWNLOAD_MEDIA");
    }

    if (!media.filename || media.mimetype === "audio/mp4") {
      const ext = media.mimetype === "audio/mp4" ? "m4a" : media.mimetype.split("/")[1].split(";")[0];
      media.filename = `${new Date().getTime()}.${ext}`;
    } else {
      // ext = tudo depois do ultimo .
      const ext = media.filename.split(".").pop();
      // name = tudo antes do ultimo .
      const name = media.filename.split(".").slice(0, -1).join(".").replace(/\s/g, '_').normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      media.filename = `${name.trim()}_${new Date().getTime()}.${ext}`;
    }

    try {



      const folder = path.resolve(__dirname, "..", "..", "..", "public", `company${ticket.companyId}`);

      // const folder = `public/company${ticket.companyId}`; // Correção adicionada por Altemir 16-08-2023
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true }); // Correção adicionada por Altemir 16-08-2023
        fs.chmodSync(folder, 0o777)
      }

      await writeFileAsync(join(folder, media.filename), media.data.toString('base64'), "base64") // Correção adicionada por Altemir 16-08-2023

    } catch (err) {
      Sentry.setExtra('Erro media', { companyId: ticket.companyId, ticket, contact, media, quotedMsg });
      Sentry.captureException(err);
      logger.error(err);
      console.log(msg)
    }
    const body = getBodyMessage(msg);
    const messageData = {
      wid: msg.key.id,
      ticketId: ticket.id,
      contactId: msg.key.fromMe ? undefined : contact.id,
      body: body || media.filename,
      fromMe: msg.key.fromMe,
      read: msg.key.fromMe,
      mediaUrl: media.filename,
      mediaType: media.mimetype.split("/")[0],
      quotedMsgId: quotedMsg?.id,
      ack: msg.status,
      remoteJid: msg.key.remoteJid,
      participant: msg.key.participant,
      dataJson: JSON.stringify(msg),
      ticketTrakingId: ticketTraking?.id,
      createdAt: new Date(
        Math.floor(getTimestampMessage(msg.messageTimestamp) * 1000)
      ).toISOString(),
      ticketImported: ticket.imported,
      isForwarded
    };

    await ticket.update({
      lastMessage: body || media.filename
    });

    const newMessage = await CreateMessageService({
      messageData,
      companyId: ticket.companyId
    });

    if (!msg.key.fromMe && ticket.status === "closed") {
      await ticket.update({ status: "pending" });
      await ticket.reload({
        include: [
          { model: Queue, as: "queue" },
          { model: User, as: "user" },
          { model: Contact, as: "contact" }
        ]
      });

      io.to("closed").emit(`company-${ticket.companyId}-ticket`, {
        action: "delete",
        ticket,
        ticketId: ticket.id
      });

      io.to(ticket.status)
        .to(ticket.id.toString())
        .emit(`company-${ticket.companyId}-ticket`, {
          action: "update",
          ticket,
          ticketId: ticket.id
        });
    }

    return newMessage;
  } catch (error) {
    console.log(error);
    logger.warn("Erro ao baixar media");
  }
};

export const verifyMessage = async (
  msg: proto.IWebMessageInfo,
  ticket: Ticket,
  contact: Contact,
  ticketTraking?: TicketTraking,
  isPrivate?: boolean,
  isForwarded?: boolean
) => {
  const io = getIO();
  const quotedMsg = await verifyQuotedMessage(msg);
  const body = getBodyMessage(msg);

  const messageData = {
    wid: msg.key.id,
    ticketId: ticket.id,
    contactId: msg.key.fromMe ? undefined : contact.id,
    body,
    fromMe: msg.key.fromMe,
    mediaType: getTypeMessage(msg),
    read: msg.key.fromMe,
    quotedMsgId: quotedMsg?.id,
    ack: msg.status,
    remoteJid: msg.key.remoteJid,
    participant: msg.key.participant,
    dataJson: JSON.stringify(msg),
    ticketTrakingId: ticketTraking?.id,
    isPrivate,
    createdAt: new Date(
      Math.floor(getTimestampMessage(msg.messageTimestamp) * 1000)
    ).toISOString(),
    ticketImported: ticket.imported,
    isForwarded
  };

  await ticket.update({
    lastMessage: body
  });

  await CreateMessageService({ messageData, companyId: ticket.companyId });

  if (!msg.key.fromMe && ticket.status === "closed") {
    await ticket.update({ status: "pending" });
    await ticket.reload({
      include: [
        { model: Queue, as: "queue" },
        { model: User, as: "user" },
        { model: Contact, as: "contact" }
      ]
    });

    io.to("closed").emit(`company-${ticket.companyId}-ticket`, {
      action: "delete",
      ticket,
      ticketId: ticket.id
    });

    if (!ticket.imported) {
      io.to(ticket.status)
        .to(ticket.id.toString())
        .emit(`company-${ticket.companyId}-ticket`, {
          action: "update",
          ticket,
          ticketId: ticket.id
        });

    }

  }
};

const isValidMsg = (msg: proto.IWebMessageInfo): boolean => {
  if (msg.key.remoteJid === "status@broadcast") return false;
  try {
    const msgType = getTypeMessage(msg);
    if (!msgType) {
      return;
    }

    const ifType =
      msgType === "conversation" ||
      msgType === "extendedTextMessage" ||
      msgType === "audioMessage" ||
      msgType === "videoMessage" ||
      msgType === "imageMessage" ||
      msgType === "documentMessage" ||
      msgType === "stickerMessage" ||
      msgType === "buttonsResponseMessage" ||
      msgType === "buttonsMessage" ||
      msgType === "messageContextInfo" ||
      msgType === "locationMessage" ||
      msgType === "liveLocationMessage" ||
      msgType === "contactMessage" ||
      msgType === "voiceMessage" ||
      msgType === "mediaMessage" ||
      msgType === "contactsArrayMessage" ||
      msgType === "reactionMessage" ||
      msgType === "ephemeralMessage" ||
      msgType === "protocolMessage" ||
      msgType === "listResponseMessage" ||
      msgType === "listMessage" ||
      msgType === "viewOnceMessage" ||
      msgType === "documentWithCaptionMessage" ||
      msgType === "viewOnceMessageV2" ||
      msgType === "editedMessage";

    if (!ifType) {
      logger.warn(`#### Nao achou o type em isValidMsg: ${msgType}
${JSON.stringify(msg?.message)}`);
      Sentry.setExtra("Mensagem", { BodyMsg: msg.message, msg, msgType });
      Sentry.captureException(new Error("Novo Tipo de Mensagem em isValidMsg"));
    }

    return !!ifType;
  } catch (error) {
    Sentry.setExtra("Error isValidMsg", { msg });
    Sentry.captureException(error);



  }
};

const sendDialogflowAwswer = async (
  wbot: Session,
  ticket: Ticket,
  msg: WAMessage,
  contact: Contact,
  inputAudio: string | undefined
) => {
  const integrations = await ShowQueueIntegrationService(ticket.integrationId, ticket.companyId);

  const session = await createDialogflowSessionWithModel(
    integrations
  );

  if (session === undefined) {
    return;
  }

  wbot.presenceSubscribe(contact.remoteJid);
  await delay(500)

  let dialogFlowReply = await queryDialogFlow(
    session,
    integrations.projectName,
    contact.remoteJid,
    getBodyMessage(msg),
    integrations.language,
    inputAudio
  );

  if (!dialogFlowReply) {
    wbot.sendPresenceUpdate("composing", contact.remoteJid);

    const bodyDuvida = formatBody(`\u200e *${ticket?.queueIntegration?.name}:* Não consegui entender sua dúvida.`)


    await delay(1000);

    await wbot.sendPresenceUpdate('paused', contact.remoteJid)

    const sentMessage = await wbot.sendMessage(
      `${contact.number}@c.us`, {
      text: bodyDuvida
    }
    );

    await verifyMessage(sentMessage, ticket, contact);
    return;
  }

  if (dialogFlowReply.endConversation) {
    await ticket.update({
      contactId: ticket.contact.id.toString(),
      useIntegration: false
    });
  }

  const image = dialogFlowReply.parameters.image?.stringValue ?? undefined;

  const react = dialogFlowReply.parameters.react?.stringValue ?? undefined;

  const audio = dialogFlowReply.encodedAudio.toString("base64") ?? undefined;

  wbot.sendPresenceUpdate("composing", contact.remoteJid);
  await delay(500);

  let lastMessage;

  for (let message of dialogFlowReply.responses) {
    lastMessage = message.text.text[0] ? message.text.text[0] : lastMessage;
  }
  for (let message of dialogFlowReply.responses) {
    if (message.text) {
      await sendDelayedMessages(
        wbot,
        ticket,
        contact,
        msg,
        message.text.text[0],
        lastMessage,
        image,
        audio,
        react
      );
    }
  }
};

async function sendDelayedMessages(
  wbot: Session,
  ticket: Ticket,
  contact: Contact,
  msg: WAMessage,
  message: string,
  lastMessage: string,
  sendImage: string | undefined,
  audio: string | undefined,
  react: string | undefined
) {
  const whatsapp = await ShowWhatsAppService(wbot.id!, ticket.companyId);
  const farewellMessage = whatsapp.farewellMessage.replace(/[_*]/g, "");
  const integrations = await ShowQueueIntegrationService(ticket.integrationId, ticket.companyId);

  // if (react) {
  //   const test =
  //     /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g.test(
  //       react
  //     );
  //   if (test) {
  //     msg.react(react);
  //     await delay(1000);
  //   }
  // }

  const sentMessage = await wbot.sendMessage(
    `${contact.number}@c.us`, {
    text: `\u200e *${ticket.queueIntegration?.name}:* ` + message
  }
  );


  await verifyMessage(sentMessage, ticket, contact);
  if (message != lastMessage) {
    await delay(500);
    wbot.sendPresenceUpdate("composing", contact.remoteJid);
  } else if (audio) {
    wbot.sendPresenceUpdate("recording", contact.remoteJid);
    await delay(500);


    // if (audio && message === lastMessage) {
    //   const newMedia = new MessageMedia("audio/ogg", audio);

    //   const sentMessage = await wbot.sendMessage(
    //     `${contact.number}@c.us`,
    //     newMedia,
    //     {
    //       sendAudioAsVoice: true
    //     }
    //   );

    //   await verifyMessage(sentMessage, ticket, contact);
    // }

    // if (sendImage && message === lastMessage) {
    //   const newMedia = await MessageMedia.fromUrl(sendImage, {
    //     unsafeMime: true
    //   });
    //   const sentMessage = await wbot.sendMessage(
    //     `${contact.number}@c.us`,
    //     newMedia,
    //     {
    //       sendAudioAsVoice: true
    //     }
    //   );

    //   await verifyMessage(sentMessage, ticket, contact);
    //   await ticket.update({ lastMessage: "📷 Foto" });
    // }

    if (farewellMessage && message.includes(farewellMessage)) {
      await delay(10000);
      setTimeout(async () => {
        await ticket.update({
          contactId: ticket.contact.id.toString(),
          useIntegration: true
        });
        await UpdateTicketService({
          ticketId: ticket.id,
          ticketData: { status: "closed" },
          companyId: ticket.companyId
        });
      }, 3000);
    }
  }
}

const verifyQueue = async (
  wbot: Session,
  msg: proto.IWebMessageInfo,
  ticket: Ticket,
  contact: Contact,
  settings?: any
) => {
  const { queues, greetingMessage, maxUseBotQueues, timeUseBotQueues } = await ShowWhatsAppService(wbot.id!, ticket.companyId);

  const ticketTraking = await FindOrCreateATicketTrakingService({
    ticketId: ticket.id,
    companyId: ticket.companyId,
    whatsappId: ticket.whatsapp?.id
  });

  let chatbot = false;

  if (queues.length === 1) {

    chatbot = queues[0]?.chatbots.length > 1;
  }

  const enableQueuePosition = settings.queuePosition === "enabled" || false;

  if (queues.length === 1 && !chatbot) {
    const sendGreetingMessageOneQueues = settings.sendGreetingMessageOneQueues === "enabled" || false;

    if (greetingMessage.length > 1 && sendGreetingMessageOneQueues) {

      const body = formatBody(`${greetingMessage}`, ticket);

      if (ticket.whatsapp.greetingMediaAttachment !== null) {
        const filePath = path.resolve("public", `company${ticket.companyId}`, ticket.whatsapp.greetingMediaAttachment);

        const messagePath = ticket.whatsapp.greetingMediaAttachment
        const optionsMsg = await getMessageOptions(messagePath, filePath, String(ticket.companyId), body);

        const sentMessage = await wbot.sendMessage(`${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, { ...optionsMsg });

        await verifyMediaMessage(sentMessage, ticket, contact, ticketTraking, false, wbot);
      } else {
        await wbot.sendMessage(
          `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          {
            text: body
          }
        );
      }
    }

    await UpdateTicketService({
      ticketData: { queueId: queues[0].id },
      ticketId: ticket.id,
      companyId: ticket.companyId
    });

    const count = await Ticket.findAndCountAll({
      where: {
        userId: null,
        status: "pending",
        companyId: ticket.companyId,
        queueId: queues[0].id,
        isGroup: false
      }
    });

    if (enableQueuePosition) {
      // Lógica para enviar posição da fila de atendimento
      const qtd = count.count === 0 ? 1 : count.count
      const msgFila = `*Assistente Virtual:*\n{{ms}} *{{name}}*, sua posição na fila de atendimento é: *${qtd}*`;
      const bodyFila = formatBody(`${msgFila}`, ticket);
      const debouncedSentMessagePosicao = debounce(
        async () => {
          await wbot.sendMessage(
            `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
            }`,
            {
              text: bodyFila
            }
          );
        },
        3000,
        ticket.id
      );
      debouncedSentMessagePosicao();
    }

    return;
  }


  // REGRA PARA DESABILITAR O BOT PARA ALGUM CONTATO
  if (contact.disableBot) {
    return;
  }

  let selectedOption = "";

  if (ticket.status !== "lgpd") {
    selectedOption =
      msg?.message?.buttonsResponseMessage?.selectedButtonId ||
      msg?.message?.listResponseMessage?.singleSelectReply.selectedRowId ||
      getBodyMessage(msg);
  } else {
    if (!isNil(ticket.lgpdAcceptedAt))
      await ticket.update({
        status: "pending"
      });

    await ticket.reload();
  }

  if (selectedOption == "Sair") {
    // Encerra atendimento

    const ticketData = {
      isBot: false,
      queueId: null,
      userId: null,
      status: "closed",
      sendFarewellMessage: false,
      maxUseBotQueues: 0
    };

    await UpdateTicketService({ ticketData, ticketId: ticket.id, companyId: ticket.companyId })
    // await ticket.update({ queueOptionId: null, chatbot: false, queueId: null, userId: null, status: "closed"});
    //await verifyQueue(wbot, msg, ticket, ticket.contact);

    const complationMessage = ticket.whatsapp?.complationMessage;

    const textMessage = {
      text: formatBody(`\u200e${complationMessage}`, ticket),
    };

    if (!isNil(complationMessage)) {
      const sendMsg = await wbot.sendMessage(
        `${ticket?.contact?.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
        textMessage
      );

      await verifyMessage(sendMsg, ticket, ticket.contact);
    }
    return;
  }

  const choosenQueue = (chatbot && queues.length === 1) ? queues[+selectedOption] : queues[+selectedOption - 1];

  const typeBot = settings?.chatBotType || "text";

  // Serviço p/ escolher consultor aleatório para o ticket, ao selecionar fila.
  let randomUserId;

  if (choosenQueue) {
    try {
      const userQueue = await ListUserQueueServices(choosenQueue.id);

      if (userQueue.userId > -1) {
        randomUserId = userQueue.userId;
      }

    } catch (error) {
      console.error(error);
    }
  }

  // Ativar ou desativar opção de escolher consultor aleatório.
  /*   let settings = await CompaniesSettings.findOne({
      where: {
        companyId: ticket.companyId
      }
    }); */

  const botText = async () => {
    if (choosenQueue || (queues.length === 1 && chatbot)) {
      const queue = await Queue.findByPk(choosenQueue.id);

      let currentSchedule;

      if (settings?.scheduleType === "queue") {
        currentSchedule = await VerifyCurrentSchedule(ticket.companyId, queue.id);
      }

      if (
        settings?.scheduleType === "queue" &&
        !isNil(currentSchedule) &&
        (!currentSchedule || currentSchedule.inActivity === false)
      ) {

        const outOfHoursMessage = queue.outOfHoursMessage;

        if (outOfHoursMessage !== "") {

          const body = formatBody(`${outOfHoursMessage}`, ticket);

          const debouncedSentMessage = debounce(
            async () => {
              await wbot.sendMessage(
                `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
                }`,
                {
                  text: body
                }
              );
            },
            1000,
            ticket.id
          );
          debouncedSentMessage();

          //atualiza o contador de vezes que enviou o bot e que foi enviado fora de hora
          await ticket.update({
            isOutOfHour: true,
            amountUsedBotQueues: ticket.amountUsedBotQueues + 1
          });

          return;

        }
        //atualiza o contador de vezes que enviou o bot e que foi enviado fora de hora
        await ticket.update({
          isOutOfHour: true,
          amountUsedBotQueues: ticket.amountUsedBotQueues + 1
        });
        return;
      }

      await UpdateTicketService({
        ticketData: { amountUsedBotQueues: 0, queueId: choosenQueue.id },
        // ticketData: { queueId: queues.length ===1 ? null : choosenQueue.id },
        ticketId: ticket.id,
        companyId: ticket.companyId
      });
      // }

      if (choosenQueue.chatbots.length > 0) {
        let options = "";
        choosenQueue.chatbots.forEach((chatbot, index) => {
          options += `*${index + 1}* - ${chatbot.name}\n`;
        });

        const body = formatBody(
          `\u200e${choosenQueue.greetingMessage}\n\n${options}\n*#* Voltar para o menu principal`,
          ticket
        );

        const sentMessage = await wbot.sendMessage(
          `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          {
            text: body
          }
        );

        await verifyMessage(sentMessage, ticket, contact, ticketTraking);

        if (settings?.settingsUserRandom === "enabled") {
          await UpdateTicketService({
            ticketData: { userId: randomUserId },
            ticketId: ticket.id,
            companyId: ticket.companyId
          });
        }
      }

      if (!choosenQueue.chatbots.length && choosenQueue.greetingMessage.length !== 0) {

        const body = formatBody(
          `\u200e${choosenQueue.greetingMessage}`,
          ticket
        );
        const sentMessage = await wbot.sendMessage(
          `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          {
            text: body
          }
        );

        await verifyMessage(sentMessage, ticket, contact, ticketTraking);
      }

      const count = await Ticket.findAndCountAll({
        where: {
          userId: null,
          status: "pending",
          companyId: ticket.companyId,
          queueId: choosenQueue.id,
          isGroup: false
        }
      });

      await CreateLogTicketService({
        ticketId: ticket.id,
        type: "queue",
        queueId: choosenQueue.id
      });

      if (enableQueuePosition && !choosenQueue.chatbots.length) {
        // Lógica para enviar posição da fila de atendimento
        const qtd = count.count === 0 ? 1 : count.count
        const msgFila = `*Assistente Virtual:*\n{{ms}} *{{name}}*, sua posição na fila de atendimento é: *${qtd}*`;
        const bodyFila = formatBody(`${msgFila}`, ticket);
        const debouncedSentMessagePosicao = debounce(
          async () => {
            await wbot.sendMessage(
              `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
              }`,
              {
                text: bodyFila
              }
            );
          },
          3000,
          ticket.id
        );
        debouncedSentMessagePosicao();
      }


    } else {

      if (maxUseBotQueues && maxUseBotQueues !== 0 && ticket.amountUsedBotQueues >= maxUseBotQueues) {
        // await UpdateTicketService({
        //   ticketData: { queueId: queues[0].id },
        //   ticketId: ticket.id
        // });

        return;
      }

      //Regra para desabilitar o chatbot por x minutos/horas após o primeiro envio
      const ticketTraking = await FindOrCreateATicketTrakingService({ ticketId: ticket.id, companyId: ticket.companyId });
      let dataLimite = new Date();
      let Agora = new Date();


      if (ticketTraking.chatbotAt !== null) {
        dataLimite.setMinutes(ticketTraking.chatbotAt.getMinutes() + (Number(timeUseBotQueues)));

        if (ticketTraking.chatbotAt !== null && Agora < dataLimite && timeUseBotQueues !== "0") {
          return
        }
      }
      await ticketTraking.update({
        chatbotAt: null
      })


      let options = "";


      queues.forEach((queue, index) => {
        options += `*[ ${index + 1} ]* - ${queue.name}\n`;
      });
      options += `\n*[ Sair ]* - Encerrar Atendimento`;

      const body = formatBody(
        `\u200e${greetingMessage}\n\n${options}`,
        ticket
      );

      await CreateLogTicketService({
        ticketId: ticket.id,
        type: "chatBot"
      });

      if (ticket.whatsapp.greetingMediaAttachment !== null) {
        const filePath = path.resolve("public", `company${ticket.companyId}`, ticket.whatsapp.greetingMediaAttachment);

        const messagePath = ticket.whatsapp.greetingMediaAttachment
        const optionsMsg = await getMessageOptions(messagePath, filePath, String(ticket.companyId), body);

        let sentMessage = await wbot.sendMessage(`${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, { ...optionsMsg });

        await verifyMediaMessage(sentMessage, ticket, contact, ticketTraking, false, wbot);

        await UpdateTicketService({
          ticketData: { amountUsedBotQueues: ticket.amountUsedBotQueues + 1 },
          ticketId: ticket.id,
          companyId: ticket.companyId
        });

        return
      } else {

        const debouncedSentMessage = debounce(
          async () => {
            const sentMessage = await wbot.sendMessage(
              `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
              {
                text: body
              }
            );

            verifyMessage(sentMessage, ticket, contact, ticketTraking);
          },
          1000,
          ticket.id
        );

        await UpdateTicketService({
          ticketData: { amountUsedBotQueues: ticket.amountUsedBotQueues + 1 },
          ticketId: ticket.id,
          companyId: ticket.companyId
        });

        debouncedSentMessage();
      }
    }
  };

  const botButton = async () => {
    if (choosenQueue) {

      // if (settingsUserRandom?.value === "enabled") {
      //   await UpdateTicketService({
      //     ticketData: { queueId: choosenQueue.id, userId: randomUserId },
      //     ticketId: ticket.id,
      //     companyId: ticket.companyId,
      //     ratingId: undefined
      //   });
      // }
      // else {
      await UpdateTicketService({
        ticketData: { queueId: choosenQueue.id },
        ticketId: ticket.id,
        companyId: ticket.companyId
      });
      // }

      if (choosenQueue.chatbots.length > 0) {
        const buttons = [];
        choosenQueue.chatbots.forEach((queue, index) => {
          buttons.push({
            buttonId: `${index + 1}`,
            buttonText: { displayText: queue.name },
            type: 1
          });
        });

        const buttonMessage = {
          text: formatBody(`${choosenQueue.greetingMessage}`, ticket),
          buttons,
          headerType: 4
        };

        const sendMsg = await wbot.sendMessage(
          `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          buttonMessage
        );

        await verifyMessage(sendMsg, ticket, contact, ticketTraking);
      }

      if (!choosenQueue.chatbots.length) {
        const body = formatBody(
          `${choosenQueue.greetingMessage}`,
          ticket
        );
        const sentMessage = await wbot.sendMessage(
          `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          {
            text: body
          }
        );

        await verifyMessage(sentMessage, ticket, contact, ticketTraking);
      }
    } else {
      const buttons = [];
      queues.forEach((queue, index) => {
        buttons.push({
          buttonId: `${index + 1}`,
          buttonText: { displayText: queue.name },
          type: 4
        });
      });

      const buttonMessage = {
        text: formatBody(`${greetingMessage}`, ticket),
        footer: "",
        buttons: buttons,
        headerType: 4
      };

      const sendMsg = await wbot.sendMessage(
        `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
        buttonMessage
      );

      await verifyMessage(sendMsg, ticket, contact, ticketTraking);

      await UpdateTicketService({
        ticketData: { amountUsedBotQueues: ticket.amountUsedBotQueues + 1 },
        ticketId: ticket.id,
        companyId: ticket.companyId
      });

    }
  };

  const botList = async () => {
    if (choosenQueue) {

      // if (settingsUserRandom?.value === "enabled") {
      //   await UpdateTicketService({
      //     ticketData: { queueId: choosenQueue.id, userId: randomUserId },
      //     ticketId: ticket.id,
      //     companyId: ticket.companyId,
      //     ratingId: undefined
      //   });
      // }
      // else {
      await UpdateTicketService({
        ticketData: { queueId: choosenQueue.id },
        ticketId: ticket.id,
        companyId: ticket.companyId
      });
      // }

      if (choosenQueue.chatbots.length > 0) {
        const sectionsRows = [];
        choosenQueue.chatbots.forEach((queue, index) => {
          sectionsRows.push({
            title: queue.name,
            rowId: `${index + 1}`
          });
        });

        const sections = [
          {
            title: "Menu",
            rows: sectionsRows
          }
        ];

        const listMessage = {
          text: formatBody(`${choosenQueue.greetingMessage}`, ticket),
          buttonText: "Escolha uma opção",
          sections
        };

        const sendMsg = await wbot.sendMessage(
          `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          listMessage
        );

        await verifyMessage(sendMsg, ticket, contact, ticketTraking);
      }

      if (!choosenQueue.chatbots.length) {
        const body = formatBody(
          `${choosenQueue.greetingMessage}`,
          ticket
        );

        const sentMessage = await wbot.sendMessage(
          `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          {
            text: body
          }
        );

        await verifyMessage(sentMessage, ticket, contact, ticketTraking);
      }
    } else {
      const sectionsRows = [];

      queues.forEach((queue, index) => {
        sectionsRows.push({
          title: queue.name,
          rowId: `${index + 1}`
        });
      });

      const sections = [
        {
          title: "Menu",
          rows: sectionsRows
        }
      ];

      const listMessage = {
        text: formatBody(`${greetingMessage}`, ticket),
        buttonText: "Escolha uma opção",
        sections
      };

      const sendMsg = await wbot.sendMessage(
        `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
        listMessage
      );

      await verifyMessage(sendMsg, ticket, contact, ticketTraking);

      await UpdateTicketService({
        ticketData: { amountUsedBotQueues: ticket.amountUsedBotQueues + 1 },
        ticketId: ticket.id,
        companyId: ticket.companyId
      });
    }
  };

  if (typeBot === "text") {
    return botText();
  }

  if (typeBot === "button" && queues.length > 3) {
    return botText();
  }

  if (typeBot === "button" && queues.length <= 3) {
    return botButton();
  }

  if (typeBot === "list") {
    return botList();
  }
};

export const verifyRating = (ticketTraking: TicketTraking) => {
  if (
    ticketTraking &&
    ticketTraking.finishedAt === null &&
    ticketTraking.closedAt !== null &&
    ticketTraking.userId !== null &&
    ticketTraking.ratingAt === null
  ) {
    return true;
  }
  return false;
};

export const handleRating = async (
  rate: number,
  ticket: Ticket,
  ticketTraking: TicketTraking
) => {
  const io = getIO();


  const { complationMessage } = await ShowWhatsAppService(
    ticket.whatsappId,
    ticket.companyId
  );

  let finalRate = rate;

  if (rate < 0) {
    finalRate = 0;
  }
  if (rate > 10) {
    finalRate = 10;
  }

  await UserRating.create({
    ticketId: ticketTraking.ticketId,
    companyId: ticketTraking.companyId,
    userId: ticketTraking.userId,
    rate: finalRate,
  });

  if (!isNil(complationMessage) && complationMessage !== "" && !ticket.isGroup) {
    const body = formatBody(`\u200e${complationMessage}`, ticket);
    if (ticket.channel === "whatsapp") {
      const msg = await SendWhatsAppMessage({ body, ticket });

      await verifyMessage(msg, ticket, ticket.contact, ticketTraking);

    }

    if (["facebook", "instagram"].includes(ticket.channel)) {
      await sendFaceMessage({ body, ticket });
    }
  }

  await ticket.update({
    chatbot: null,
    status: "closed",
    amountUseBotQueuesNPS: 0
  });

  //loga fim de atendimento
  await CreateLogTicketService({
    userId: ticket.userId,
    queueId: ticket.queueId,
    ticketId: ticket.id,
    type: "closed"
  });

  io.to("open").emit(`company-${ticket.companyId}-ticket`, {
    action: "delete",
    ticket,
    ticketId: ticket.id,
  });

  io.to(ticket.status)
    .to(ticket.id.toString())
    .emit(`company-${ticket.companyId}-ticket`, {
      action: "update",
      ticket,
      ticketId: ticket.id
    });

};

const handleMessage = async (
  msg: proto.IWebMessageInfo,
  wbot: Session,
  companyId: number,
  isImported: boolean = false,
): Promise<void> => {

  if (isImported) {
    addLogs({ fileName: `processImportMessagesWppId${wbot.id}.txt`, text: `Importando Mensagem: ${JSON.stringify(msg, null, 2)}>>>>>>>>>>>>>>>>>>>` })

    let wid = msg.key.id
    let existMessage = await Message.findOne({
      where: { wid }
    })
    if (existMessage) {
      await new Promise(r => setTimeout(r, 150));
      console.log("Esta mensagem já existe")
      return
    } else {
      await new Promise(r => setTimeout(r, parseInt(process.env.TIMEOUT_TO_IMPORT_MESSAGE) || 330));
    }
  } else {
    await new Promise(r => setTimeout(r, i * 650));
    i++
  }

  if (!isValidMsg(msg)) {
    return;
  }

  try {
    let msgContact: IMe;
    let groupContact: Contact | undefined;
    let queueId: number = 0;
    let tagsId: number = 0;
    let userId: number = 0;

    let bodyMessage = getBodyMessage(msg);
    const msgType = getTypeMessage(msg);
    if (msgType === "protocolMessage") return; // Tratar isso no futuro para excluir msgs se vor REVOKE

    const hasMedia = msg.message?.imageMessage ||
      msg.message?.audioMessage ||
      msg.message?.videoMessage ||
      msg.message?.stickerMessage ||
      msg.message?.documentMessage ||
      msg.message?.documentWithCaptionMessage?.message?.documentMessage ||
      // msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
      // msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage ||
      // msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage ||
      msg.message?.ephemeralMessage?.message?.audioMessage ||
      msg.message?.ephemeralMessage?.message?.documentMessage ||
      msg.message?.ephemeralMessage?.message?.videoMessage ||
      msg.message?.ephemeralMessage?.message?.stickerMessage ||
      msg.message?.ephemeralMessage?.message?.imageMessage ||
      msg.message?.viewOnceMessage?.message?.imageMessage ||
      msg.message?.viewOnceMessage?.message?.videoMessage ||
      msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.imageMessage ||
      msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.videoMessage ||
      msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.audioMessage ||
      msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.documentMessage ||
      msg.message?.documentWithCaptionMessage?.message?.documentMessage ||
      msg.message?.templateMessage?.hydratedTemplate?.imageMessage ||
      msg.message?.templateMessage?.hydratedTemplate?.documentMessage ||
      msg.message?.templateMessage?.hydratedTemplate?.videoMessage ||
      msg.message?.templateMessage?.hydratedFourRowTemplate?.imageMessage ||
      msg.message?.templateMessage?.hydratedFourRowTemplate?.documentMessage ||
      msg.message?.templateMessage?.hydratedFourRowTemplate?.videoMessage ||
      msg.message?.templateMessage?.fourRowTemplate?.imageMessage ||
      msg.message?.templateMessage?.fourRowTemplate?.documentMessage ||
      msg.message?.templateMessage?.fourRowTemplate?.videoMessage ||
      msg.message?.interactiveMessage?.header?.imageMessage ||
      msg.message?.interactiveMessage?.header?.documentMessage ||
      msg.message?.interactiveMessage?.header?.videoMessage ||
      msg.message?.highlyStructuredMessage?.hydratedHsm?.hydratedTemplate?.documentMessage ||
      msg.message?.highlyStructuredMessage?.hydratedHsm?.hydratedTemplate?.videoMessage ||
      msg.message?.highlyStructuredMessage?.hydratedHsm?.hydratedTemplate?.imageMessage ||
      msg.message?.highlyStructuredMessage?.hydratedHsm?.hydratedTemplate?.locationMessage


    const isPrivate = /\u200d/.test(bodyMessage);


    if (msg.key.fromMe) {
      if (/\u200e/.test(bodyMessage)) return;
      if (
        !hasMedia &&
        msgType !== "conversation" &&
        msgType !== "extendedTextMessage" &&
        msgType !== "contactMessage" &&
        msgType !== "reactionMessage" &&
        msgType !== "ephemeralMessage" &&
        msgType !== "protocolMessage" &&
        msgType !== "viewOnceMessage" &&
        msgType !== "editedMessage"
      )
        return;
      msgContact = await getContactMessage(msg, wbot);
    } else {
      msgContact = await getContactMessage(msg, wbot);
    }

    const isGroup = msg.key.remoteJid?.endsWith("@g.us");

    // IGNORAR MENSAGENS DE GRUPO
    // const msgIsGroupBlock = await Settings.findOne({
    //   where: { key: "CheckMsgIsGroup", companyId }
    // });
    const whatsapp = await ShowWhatsAppService(wbot.id!, companyId);

    if (!whatsapp.allowGroup && isGroup) return;

    if (isGroup) {
      const grupoMeta = await wbot.groupMetadata(msg.key.remoteJid);
      const msgGroupContact = {
        id: grupoMeta.id,
        name: grupoMeta.subject
      };
      groupContact = await verifyContact(msgGroupContact, wbot, companyId);
    }


    const contact = await verifyContact(msgContact, wbot, companyId);

    let unreadMessages = 0;
    let ticket = null;

    if (msg.key.fromMe) {
      await cacheLayer.set(`contacts:${contact.id}:unreads`, "0");
    } else {
      const unreads = await cacheLayer.get(`contacts:${contact.id}:unreads`);
      unreadMessages = +unreads + 1;
      await cacheLayer.set(
        `contacts:${contact.id}:unreads`,
        `${unreadMessages}`
      );
    }

    const settings = await CompaniesSettings.findOne({
      where: { companyId }
    }
    )
    const enableLGPD = settings.enableLGPD === "enabled";

    // contador
    // if (msg.key.fromMe && count?.unreadCount > 0) {
    //   let remoteJid = msg.key.remoteJid;
    //   SendAckBYRemoteJid({ remoteJid, companyId });
    // }

    // Inclui a busca de ticket aqui, se realmente não achar um ticket, então vai para o findorcreate

    const { ticket: tck, isCreated } = await FindOrCreateTicketService(
      contact,
      whatsapp,
      unreadMessages,
      companyId,
      queueId,
      userId,
      groupContact,
      "whatsapp",
      isImported,
      false,
      settings,
    );

    ticket = tck;


    if (ticket.status === 'closed' || (
      unreadMessages === 0 &&
      whatsapp.complationMessage &&
      formatBody(whatsapp.complationMessage, ticket) === bodyMessage)
    ) {
      return;
    }


    // console.log(ticket)
    if (msgType === "editedMessage") {
      const msgKeyIdEdited = msg.message.editedMessage.message.protocolMessage.key.id;
      const bodyEdited = msg.message.editedMessage.message.protocolMessage.editedMessage.conversation;
      const io = getIO();
      try {
        const messageToUpdate = await Message.findOne({
          where: {
            wid: msgKeyIdEdited,
            companyId,
            ticketId: ticket.id
          }
        })

        if (!messageToUpdate) return

        await messageToUpdate.update({ isEdited: true, body: bodyEdited });

        await ticket.update({ lastMessage: bodyEdited })

        io.to(messageToUpdate.ticketId.toString()).emit(
          `company-${messageToUpdate.companyId}-appMessage`,
          {
            action: "update",
            message: messageToUpdate
          }
        );
      } catch (err) {
        Sentry.captureException(err);
        logger.error(`Error handling message ack. Err: ${err}`);
      }
      return
    }


    const ticketTraking = await FindOrCreateATicketTrakingService({
      ticketId: ticket.id,
      companyId,
      whatsappId: whatsapp?.id
    });

    try {
      if (!msg.key.fromMe) {
        /**
         * Tratamento para avaliação do atendente
         */
        if (ticket.status === "nps" && ticketTraking !== null && verifyRating(ticketTraking)) {

          if (!isNaN(parseFloat(bodyMessage))) {

            handleRating(parseFloat(bodyMessage), ticket, ticketTraking);

            await ticketTraking.update({
              ratingAt: moment().toDate(),
              finishedAt: moment().toDate(),
              rated: true
            });

            return;
          } else {

            if (ticket.amountUseBotQueuesNPS < whatsapp.maxUseBotQueuesNPS) {
              let bodyErrorRating = `\u200eOpção inválida, tente novamente.\n`;
              const sentMessage = await wbot.sendMessage(
                `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
                }`,
                {
                  text: bodyErrorRating
                }
              );

              verifyMessage(sentMessage, ticket, contact, ticketTraking);


              await delay(1000);

              let bodyRatingMessage = `\u200e${whatsapp.ratingMessage}\n`;

              const msg = await SendWhatsAppMessage({ body: bodyRatingMessage, ticket });

              await verifyMessage(msg, ticket, ticket.contact);

              await ticket.update({
                amountUseBotQueuesNPS: ticket.amountUseBotQueuesNPS + 1
              })
            }
            return;
          }

        }

        //TRATAMENTO LGPD
        if (enableLGPD) {
          if (ticket.status === "lgpd" && settings?.enableLGPD === "enabled" && !isImported) {
            if (isNil(ticket.lgpdAcceptedAt) && !isNil(ticket.lgpdSendMessageAt)) {
              let choosenOption: number | null = null;

              if (msg?.message?.conversation) {
                choosenOption = ~~+msg.message?.conversation;
              }

              //Se digitou opção numérica
              if (!Number.isNaN(choosenOption) && Number.isInteger(choosenOption) && !isNull(choosenOption) && choosenOption > 0) {
                //Se digitou 1, aceitou o termo e vai pro bot
                if (choosenOption === 1) {
                  await contact.update({
                    lgpdAcceptedAt: moment().toDate(),
                  });
                  await ticket.update({
                    lgpdAcceptedAt: moment().toDate(),
                    amountUsedBotQueues: 0
                  });
                  //Se digitou 2, recusou o bot e encerra chamado
                } else if (choosenOption === 2) {

                  if (whatsapp.complationMessage !== "" && whatsapp.complationMessage !== undefined) {

                    const sentMessage = await wbot.sendMessage(
                      `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
                      }`,
                      {
                        text: `\u200e${whatsapp.complationMessage}`
                      }
                    );

                    verifyMessage(sentMessage, ticket, contact, ticketTraking);
                  }

                  await ticket.update({
                    status: "closed",
                    amountUsedBotQueues: 0
                  })

                  await ticketTraking.destroy;

                  return
                  //se digitou qualquer opção que não seja 1 ou 2 limpa o lgpdSendMessageAt para 
                  //enviar de novo o bot respeitando o numero máximo de vezes que o bot é pra ser enviado
                } else {
                  if (ticket.amountUsedBotQueues < whatsapp.maxUseBotQueues) {
                    await ticket.update(
                      {
                        amountUsedBotQueues: ticket.amountUsedBotQueues + 1
                        , lgpdSendMessageAt: null
                      });
                  }
                }
                //se digitou qualquer opção que não número o lgpdSendMessageAt para 
                //enviar de novo o bot respeitando o numero máximo de vezes que o bot é pra ser enviado
              } else {
                if (ticket.amountUsedBotQueues < whatsapp.maxUseBotQueues) {
                  await ticket.update(
                    {
                      amountUsedBotQueues: ticket.amountUsedBotQueues + 1
                      , lgpdSendMessageAt: null
                    });
                }
              }
            }

            if ((contact.lgpdAcceptedAt === null || settings?.lgpdConsent === "enabled") &&
              !contact.isGroup && isNil(ticket.lgpdSendMessageAt) &&
              ticket.amountUsedBotQueues <= whatsapp.maxUseBotQueues && !isNil(settings?.lgpdMessage)
            ) {
              if (hasMedia) {
                await verifyMediaMessage(msg, ticket, contact, ticketTraking, false, wbot);
              } else {
                await verifyMessage(msg, ticket, contact, ticketTraking, isPrivate);
              }

              if (!isNil(settings?.lgpdMessage) && settings.lgpdMessage !== "") {
                const bodyMessageLGPD = formatBody(`\u200e${settings?.lgpdMessage}`, ticket);

                const sentMessage = await wbot.sendMessage(
                  `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
                  }`,
                  {
                    text: bodyMessageLGPD
                  }
                );

                verifyMessage(sentMessage, ticket, contact, ticketTraking);

              }
              await delay(1000);

              if (!isNil(settings?.lgpdLink) && settings?.lgpdLink !== "") {
                const bodyLink = formatBody(`\u200e${settings?.lgpdLink}`, ticket);
                const sentMessage = await wbot.sendMessage(
                  `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
                  }`,
                  {
                    text: bodyLink
                  }
                );

                await verifyMessage(sentMessage, ticket, contact, ticketTraking);
              };

              await delay(1000);

              const bodyBot = formatBody(
                `\u200eEstou ciente sobre o tratamento dos meus dados pessoais. \n\n*[1]* Sim\n*[2]* Não`,
                ticket
              );

              const sentMessageBot = await wbot.sendMessage(
                `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
                }`,
                {
                  text: bodyBot
                }

              );

              await verifyMessage(sentMessageBot, ticket, contact, ticketTraking);

              await ticket.update({
                lgpdSendMessageAt: moment().toDate(),
                amountUsedBotQueues: ticket.amountUsedBotQueues + 1
              });

              await ticket.reload();

              return;

            };

            if (!isNil(ticket.lgpdSendMessageAt) && isNil(ticket.lgpdAcceptedAt))
              return
          }
        }
      }
    } catch (e) {
      Sentry.captureException(e);
      console.log(e);
    }

    const isMsgForwarded = msg.message?.extendedTextMessage?.contextInfo?.isForwarded ||
      msg.message?.imageMessage?.contextInfo?.isForwarded ||
      msg.message?.audioMessage?.contextInfo?.isForwarded ||
      msg.message?.videoMessage?.contextInfo?.isForwarded ||
      msg.message?.documentMessage?.contextInfo?.isForwarded

    if (hasMedia) {
      await verifyMediaMessage(msg, ticket, contact, ticketTraking, isMsgForwarded, wbot);
    } else {
      await verifyMessage(msg, ticket, contact, ticketTraking, isPrivate, isMsgForwarded);
    }


    // Atualiza o ticket se a ultima mensagem foi enviada por mim, para que possa ser finalizado. 
    try {
      await ticket.update({
        fromMe: msg.key.fromMe,
      });
    } catch (e) {
      Sentry.captureException(e);
      console.log(e);
    }

    let currentSchedule;

    if (settings.scheduleType === "company") {
      currentSchedule = await VerifyCurrentSchedule(companyId);
    }

    try {
      if (!msg.key.fromMe && settings.scheduleType) {
        /**
         * Tratamento para envio de mensagem quando a empresa está fora do expediente
         */
        if (
          settings.scheduleType === "company" &&
          !isNil(currentSchedule) &&
          (!currentSchedule || currentSchedule.inActivity === false)
        ) {
          if (ticketTraking.chatbotAt === null) {
            await ticketTraking.update({
              chatbotAt: moment().toDate(),
            })
          }

          if (whatsapp.maxUseBotQueues && whatsapp.maxUseBotQueues !== 0 && ticket.amountUsedBotQueues >= whatsapp.maxUseBotQueues) {
            // await UpdateTicketService({
            //   ticketData: { queueId: queues[0].id },
            //   ticketId: ticket.id
            // });

            return;
          }

          //Regra para desabilitar o chatbot por x minutos/horas após o primeiro envio
          let dataLimite = new Date();
          let Agora = new Date();


          if (ticketTraking.chatbotAt !== null) {
            dataLimite.setMinutes(ticketTraking.chatbotAt.getMinutes() + (Number(whatsapp.timeUseBotQueues)));

            if (ticketTraking.chatbotAt !== null && Agora < dataLimite && whatsapp.timeUseBotQueues !== "0") {
              return
            }
          }

          await ticketTraking.update({
            chatbotAt: null
          })

          if (whatsapp.outOfHoursMessage !== "") {

            const body = formatBody(`${whatsapp.outOfHoursMessage}`, ticket);

            const debouncedSentMessage = debounce(
              async () => {
                await wbot.sendMessage(
                  `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
                  }`,
                  {
                    text: body
                  }
                );
              },
              1000,
              ticket.id
            );
            debouncedSentMessage();

            //atualiza o contador de vezes que enviou o bot e que foi enviado fora de hora
            await ticket.update({
              isOutOfHour: true,
              amountUsedBotQueues: ticket.amountUsedBotQueues + 1
            });

            return;

          }

          //atualiza o contador de vezes que enviou o bot e que foi enviado fora de hora
          await ticket.update({
            isOutOfHour: true,
            amountUsedBotQueues: ticket.amountUsedBotQueues + 1
          });

          return;
        }
      }
    } catch (e) {
      Sentry.captureException(e);
      console.log(e);
    }


    if (
      !ticket.imported &&
      !ticket.queue &&
      !isGroup &&
      !msg.key.fromMe &&
      !ticket.userId &&
      whatsapp.queues.length >= 1
    ) {
      await verifyQueue(wbot, msg, ticket, contact, settings);

      if (ticketTraking.chatbotAt === null) {
        await ticketTraking.update({
          chatbotAt: moment().toDate(),
        })
      }
    }

    //inicia integração dialogflow/n8n
    if (
      !msg.key.fromMe &&
      !ticket.isGroup &&
      ticket.queue &&
      ticket.integrationId
      && ticket.useIntegration
    ) {
      const integrations = await ShowQueueIntegrationService(ticket.integrationId, companyId);

      if (integrations.type === "n8n" || integrations.type === "webhook") {
        if (integrations?.urlN8N) {
          const options = {
            method: "POST",
            url: integrations?.urlN8N,
            headers: {
              "Content-Type": "application/json"
            },
            json: msg
          };
          try {
            const response = await request(options);
            console.log(response.body);
          } catch (error) {
            throw new Error(error);
          }
        }

      } else if (integrations.type === "dialogflow") {
        let inputAudio: string | undefined;

        if (msgType === "audioMessage") {
          let filename = `${msg.messageTimestamp}.ogg`;
          readFile(
            join(__dirname, "..", "..", "..", "public", `company${companyId}`, filename),
            "base64",
            (err, data) => {
              inputAudio = data;
              if (err) {
                logger.error(err);
              }
            }
          );
        } else {
          inputAudio = undefined;
        }
        console.log("ENTROU NO DIALOGFLOW");

        const debouncedSentMessage = debounce(
          async () => {
            await sendDialogflowAwswer(
              wbot,
              ticket,
              msg,
              contact,
              inputAudio
            );
          },
          500,
          ticket.id
        );
        debouncedSentMessage();
      } else if (integrations.type === "typebot") {

      }
    }

    if (ticket.queueId > 0) {
      await ticketTraking.update({
        queueId: ticket.queueId
      })
    }

    // Verificação se aceita audio do contato
    if (
      getTypeMessage(msg) === "audioMessage" &&
      !msg.key.fromMe &&
      !isGroup &&
      !contact?.acceptAudioMessage &&
      settings?.acceptAudioMessageContact === "disabled"
    ) {
      const sentMessage = await wbot.sendMessage(
        `${contact.number}@c.us`,
        {
          text: "*Assistente Virtual*:\nInfelizmente não conseguimos escutar nem enviar áudios por este canal de atendimento, por favor, envie uma mensagem de *texto*."
        },
        {
          quoted: {
            key: msg.key,
            message: {
              extendedTextMessage: msg.message.extendedTextMessage
            }
          }
        }
      );
      await verifyMessage(sentMessage, ticket, contact, ticketTraking);
    }


    try {
      if (!msg.key.fromMe && settings?.scheduleType && ticket.queueId !== null) {
        /**
         * Tratamento para envio de mensagem quando a empresa/fila está fora do expediente
         */

        const queue = await Queue.findByPk(ticket.queueId)

        if (settings?.scheduleType === "queue") {
          currentSchedule = await VerifyCurrentSchedule(companyId, queue.id);
        }

        if (
          settings?.scheduleType === "queue" &&
          !isNil(currentSchedule) &&
          (!currentSchedule || currentSchedule.inActivity === false)
        ) {

          const outOfHoursMessage = queue.outOfHoursMessage;

          if (outOfHoursMessage !== "") {

            const body = formatBody(`${outOfHoursMessage}`, ticket);

            const debouncedSentMessage = debounce(
              async () => {
                await wbot.sendMessage(
                  `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
                  }`,
                  {
                    text: body
                  }
                );
              },
              1000,
              ticket.id
            );
            debouncedSentMessage();

            //atualiza o contador de vezes que enviou o bot e que foi enviado fora de hora
            await ticket.update({
              isOutOfHour: true,
              amountUsedBotQueues: ticket.amountUsedBotQueues + 1
            });

            return;

          }
          //atualiza o contador de vezes que enviou o bot e que foi enviado fora de hora
          await ticket.update({
            isOutOfHour: true,
            amountUsedBotQueues: ticket.amountUsedBotQueues + 1
          });
          return;
        }
      }
    } catch (e) {
      Sentry.captureException(e);
      console.log(e);
    }

    if (ticket.queue && ticket.queueId && !msg.key.fromMe) {
      if (!ticket.user || ticket.queue?.chatbots?.length > 0) {
        await sayChatbot(ticket.queueId, wbot, ticket, contact, msg);
      }

      //atualiza mensagem para indicar que houve atividade e aí contar o tempo novamente para enviar mensagem de inatividade
      await ticket.update({
        sendInactiveMessage: false
      });
    }

    await ticket.reload();

  } catch (err) {
    Sentry.captureException(err);
    console.log(err);
    logger.error(`Error handling whatsapp message: Err: ${err}`);
  }
};

const handleMsgAck = async (
  msg: WAMessage,
  chat: number | null | undefined
) => {
  await new Promise(r => setTimeout(r, 500));
  const io = getIO();

  try {
    const messageToUpdate = await Message.findOne({
      where: {
        wid: msg.key.id,
      },
      include: [
        "contact",
        {
          model: Message,
          as: "quotedMsg",
          include: ["contact"],
        },
      ],
    });

    if (!messageToUpdate) return;

    await messageToUpdate.update({ ack: chat });
    io.to(messageToUpdate.ticketId.toString()).emit(
      `company-${messageToUpdate.companyId}-appMessage`,
      {
        action: "update",
        message: messageToUpdate
      }
    );
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Error handling message ack. Err: ${err}`);
  }
};

const verifyRecentCampaign = async (
  message: proto.IWebMessageInfo,
  companyId: number
) => {
  if (!isValidMsg(message)) {
    return;
  }
  if (!message.key.fromMe) {
    const number = message.key.remoteJid.replace(/\D/g, "");
    const campaigns = await Campaign.findAll({
      where: { companyId, status: "EM_ANDAMENTO", confirmation: true }
    });
    if (campaigns) {
      const ids = campaigns.map(c => c.id);
      const campaignShipping = await CampaignShipping.findOne({
        where: { campaignId: { [Op.in]: ids }, number, confirmation: null }
      });

      if (campaignShipping) {
        await campaignShipping.update({
          confirmedAt: moment(),
          confirmation: true
        });
        await campaignQueue.add(
          "DispatchCampaign",
          {
            campaignShippingId: campaignShipping.id,
            campaignId: campaignShipping.campaignId
          },
          {
            delay: parseToMilliseconds(randomValue(0, 10))
          }
        );
      }
    }
  }
};

const verifyCampaignMessageAndCloseTicket = async (message: proto.IWebMessageInfo, companyId: number, wbot: Session) => {
  if (!isValidMsg(message)) {
    return;
  }

  let msgContact: IMe;
  msgContact = await getContactMessage(message, wbot);
  const contact = await verifyContact(msgContact, wbot, companyId);

  const io = getIO();
  const body = await getBodyMessage(message);
  const isCampaign = /\u200c/.test(body);

  if (message.key.fromMe && isCampaign) {
    const messageRecord = await Message.findOne({
      where: {
        [Op.or]: [
          { wid: message.key.id! },
          { contactId: contact.id }
        ],
        companyId
      }
    });

    if (!isNull(messageRecord) || !isNil(messageRecord) || messageRecord !== null) {
      const ticket = await Ticket.findByPk(messageRecord.ticketId);
      await ticket.update({ status: "closed", amountUsedBotQueues: 0, amountUseOutOfHours: 0 });

      io.to("open").emit(`company-${ticket.companyId}-ticket`, {
        action: "delete",
        ticket,
        ticketId: ticket.id
      });

      io.to(ticket.status)
        .to(ticket.id.toString())
        .emit(`company-${ticket.companyId}-ticket`, {
          action: "update",
          ticket,
          ticketId: ticket.id
        });
    }
  }
};

const filterMessages = (msg: WAMessage): boolean => {
  if (msg.message?.protocolMessage) return false;

  if (
    [
      WAMessageStubType.REVOKE,
      WAMessageStubType.E2E_DEVICE_CHANGED,
      WAMessageStubType.E2E_IDENTITY_CHANGED,
      WAMessageStubType.CIPHERTEXT
    ].includes(msg.messageStubType as WAMessageStubType)
  )
    return false;

  return true;
};

const wbotMessageListener = (wbot: Session, companyId: number): void => {
  wbot.ev.on("messages.upsert", async (messageUpsert: ImessageUpsert) => {
    const messages = messageUpsert.messages
      .filter(filterMessages)
      .map(msg => msg);

    if (!messages) return;

    messages.forEach(async (message: proto.IWebMessageInfo) => {

      const messageExists = await Message.count({
        where: { wid: message.key.id!, companyId }
      });

      if (!messageExists) {
        let isCampaign = false
        let body = await getBodyMessage(message);
        const fromMe = message?.key?.fromMe;
        if (fromMe) {
          isCampaign = /\u200c/.test(body)
        } else {
          if (/\u200c/.test(body))
            body = body.replace(/\u200c/, '')
          logger.debug('Validação de mensagem de campanha enviada por terceiros: ' + body)
        }

        if (!isCampaign) {
          await handleMessage(message, wbot, companyId);
        }

        await verifyRecentCampaign(message, companyId);
        await verifyCampaignMessageAndCloseTicket(message, companyId, wbot);
      }


      if (message.key.remoteJid?.endsWith("@g.us")) {
        handleMsgAck(message, 2)
      }

    });

    // messages.forEach(async (message: proto.IWebMessageInfo) => {
    //   const messageExists = await Message.count({
    //     where: { id: message.key.id!, companyId }
    //   });

    //   if (!messageExists) {
    //     await handleMessage(message, wbot, companyId);
    //     await verifyRecentCampaign(message, companyId);
    //     await verifyCampaignMessageAndCloseTicket(message, companyId);
    //   }
    // });
  });

  wbot.ev.on("messages.update", (messageUpdate: WAMessageUpdate[]) => {
    if (messageUpdate.length === 0) return;
    messageUpdate.forEach(async (message: WAMessageUpdate) => {

      (wbot as WASocket)!.readMessages([message.key])

      const msgUp = { ...messageUpdate }
      if (msgUp['0']?.update.messageStubType === 1 && msgUp['0']?.key.remoteJid !== 'status@broadcast') {
        MarkDeleteWhatsAppMessage(msgUp['0']?.key.remoteJid, null, msgUp['0']?.key.id, companyId)
      }

      let ack: any;
      if (message.update.status === 3 && message?.key?.fromMe) {
        ack = 2;
      } else {
        ack = message.update.status;
      }

      handleMsgAck(message, ack);
    });
  });

  // wbot.ev.on('message-receipt.update', (events: any) => {
  //   events.forEach(async (msg: any) => {
  //     const ack = msg?.receipt?.receiptTimestamp ? 3 : msg?.receipt?.readTimestamp ? 4 : 0;
  //     if (!ack) return;
  //     await handleMsgAck(msg, ack);
  //   });
  // })

  wbot.ev.on("groups.update", (groupUpdate: GroupMetadata[]) => {
    if (groupUpdate.length === 0) return;
    groupUpdate.forEach(async (group: GroupMetadata) => {
      const number = group.id.replace(/\D/g, "");
      const nameGroup = group.subject || number;

      const contactData = {
        name: nameGroup,
        number: number,
        isGroup: true,
        companyId: companyId
      };

      const contact = await CreateOrUpdateContactService(contactData);

    });
  })

  // wbot.ev.on("presence.update", (m) => {

  //   const number = m.id.replace(/\D/g, "");
  //   console.log('number', number)

  //   console.log('teste', m.presences[m.id]. if (!process.env.ISLOCAL) {lastKnownPresence)

  // });


  // wbot.ev.on("contacts.update", (contact: ContactBaileys[]) => {
  //   console.log('contact', contact)
  // })


  // possivel N8N
  // PROTOCOLO_ON_OF = on
  // URL_API_N8N = https://sua urll

  // if (process.env.PROTOCOLO_ON_OF === 'on') {
  //   wbot.ev.on("messages.upsert", async (messageUpsert: ImessageUpsert) => {
  //     const messages = messageUpsert.messages
  //       .filter(filterMessages)
  //       .map(msg => msg);

  //     if (!messages) return;

  //     messages.forEach(async (message: proto.IWebMessageInfo) => {
  //       const messageExists = await Message.count({
  //         where: { id: message.key.id!, companyId }
  //       });

  //       if (!messageExists) {

  //         var data = {
  //           remoteJid: message?.key?.remoteJid,
  //           id: message?.key?.id,
  //           pushName: message?.pushName,
  //           message: message?.message?.conversation
  //         }

  //         var config = {
  //           method: 'post',
  //           url: 'https://n8n.whatsatende.com.br/webhook-test/4680694b-db24-4f59-aa94-51ca54c95ce6',
  //           headers: {
  //             'Content-Type': 'application/json',
  //           },
  //           data
  //         };

  //         try {
  //           axios(config)
  //             .then(async function (response) {


  //               console.log('response', response.status)

  //             })
  //             .catch(async function (error) {
  //               // console.log('Deu erro: ', error);
  //               console.log(error.response.data)
  //             });

  //         } catch (error) {
  //           throw new Error(error);
  //         }
  //       }
  //     });
  //   });
  // }


};

export { wbotMessageListener, handleMessage, isValidMsg, getTypeMessage };
