import AppError from "../../errors/AppError";
import CompaniesSettings from "../../models/CompaniesSettings";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";
import { logger } from "../../utils/logger";

interface ExtraInfo extends ContactCustomField {
  name: string;
  value: string;
}

interface Request {
  name: string;
  number: string;
  email?: string;
  profilePicUrl?: string;
  acceptAudioMessage?: boolean;
  active?: boolean;
  companyId: number;
  extraInfo?: ExtraInfo[];
  remoteJid?: string;
}

const CreateContactService = async ({
  name,
  number,
  email = "",
  acceptAudioMessage,
  active,
  companyId,
  extraInfo = [],
  remoteJid= ""
}: Request): Promise<Contact> => {
    const numberExists = await Contact.findOne({
      where: { number, companyId }
    });

    if (numberExists) {
      throw new AppError("ERR_DUPLICATED_CONTACT");
    }

    const settings  = await CompaniesSettings.findOne({where:{
      companyId
    }})

    const { acceptAudioMessageContact } = settings;
    
    const contact = await Contact.create(
      {
        name,
        number,
        email,
        acceptAudioMessage: acceptAudioMessageContact === 'enabled' ? true : false,
        active,
        extraInfo,
        companyId,
        remoteJid
      },
      {
        include: ["extraInfo"]
      }
    );

    return contact;
 };

export default CreateContactService;
