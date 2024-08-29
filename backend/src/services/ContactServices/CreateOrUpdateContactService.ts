import { getIO } from "../../libs/socket";
import CompaniesSettings from "../../models/CompaniesSettings";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";
import fs from "fs";
import path, { join } from "path";
import { logger } from "../../utils/logger";
const axios = require('axios');

interface ExtraInfo extends ContactCustomField {
  name: string;
  value: string;
}

interface Request {
  name: string;
  number: string;
  isGroup: boolean;
  email?: string;
  profilePicUrl?: string;
  companyId: number;
  channel?: string;
  extraInfo?: ExtraInfo[];
  remoteJid?: string;
}

const CreateOrUpdateContactService = async ({
  name,
  number: rawNumber,
  profilePicUrl,
  isGroup,
  email = "",
  channel = "whatsapp",
  companyId,
  extraInfo = [],
  remoteJid = ""
}: Request): Promise<Contact> => {
  try {

    const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

    const number = isGroup ? rawNumber : rawNumber.replace(/[^0-9]/g, "");

    const io = getIO();
    let contact: Contact | null;

    const updateImage = contact?.profilePicUrl || "" !== profilePicUrl;

    contact = await Contact.findOne({
      where: {
        number,
        companyId
      }
    });
    
    if (contact) {
      contact.remoteJid = remoteJid; 
      contact.profilePicUrl = profilePicUrl;

      if (isGroup || contact.name === number) {
        contact.name = name;
      }
      contact.save();
      contact.reload();

      io.emit(`company-${companyId}-contact`, {
        action: "update",
        contact
      });
    } else {

      const settings = await CompaniesSettings.findOne({where:{companyId}})

      const { acceptAudioMessageContact } = settings

      contact = await Contact.create({
        name,
        number,  
        email,
        isGroup,
        extraInfo,
        companyId,
        channel,
        acceptAudioMessage: acceptAudioMessageContact === 'enabled' ? true : false,
        remoteJid,
        urlPicture: profilePicUrl
      });

      io.emit(`company-${companyId}-contact`, {
        action: "create",
        contact
      });
    }

    const folder =  path.resolve(publicFolder , `company${companyId}`,"contacts") 
    
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder,  { recursive: true });
      fs.chmodSync(folder, 0o777)
    }

    if (updateImage ) {
      let filename
      if (profilePicUrl.includes("nopicture")) {
        filename = "nopicture.png";
      }
      else {
      const response = await axios.get(profilePicUrl, {
        responseType: 'arraybuffer'
      });

      filename = `${contact.id}.jpeg`;
      
      // Salvar a imagem no diretório
      fs.writeFileSync(join(folder,filename), response.data);
      
      }
      contact.update({
        urlPicture: filename,
        pictureUpdated: true
      })

      io.emit(`company-${companyId}-contact`, {
        action: "update",
        contact
      });
    }
    return contact;
  } catch (err) {
    logger.error("Error to find or create a ticket:", err);
  }
};

export default CreateOrUpdateContactService;
