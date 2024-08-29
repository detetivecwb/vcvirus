import { Op } from "sequelize";
import Ticket from "../../models/Ticket"
import Whatsapp from "../../models/Whatsapp"
import { getIO } from "../../libs/socket"
import formatBody from "../../helpers/Mustache";
import SendWhatsAppMessage from "./SendWhatsAppMessage";
import moment from "moment";
import {
  WASocket,
  proto,
  } from "@whiskeysockets/baileys";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { verifyMessage } from "./wbotMessageListener";
import TicketTraking from "../../models/TicketTraking";
import CreateLogTicketService from "../TicketServices/CreateLogTicketService";

type Session = WASocket & {
  id?: number;
};

export const ClosedAllOpenTickets = async (companyId: number): Promise<void> => {

  // @ts-ignore: Unreachable code error
  const closeTicket = async (ticket: any, currentStatus: any, body: any) => {
    if (currentStatus === 'nps') {

      await ticket.update({
        status: "closed",
        //userId: ticket.userId || null,
        lastMessage: body,
        unreadMessages: 0,
        amountUseBotQueues: 0
      });

    } else if (currentStatus === 'open') {

      await ticket.update({
        status:  "closed",
      //  userId: ticket.userId || null,
        lastMessage: body,
        unreadMessages: 0,
        amountUseBotQueues: 0
      });

    } else {

      await ticket.update({
        status: "closed",
        //userId: ticket.userId || null,
        unreadMessages: 0
      });

    }

    //loga fim de atendimento automatico
    await CreateLogTicketService({
      userId: ticket.userId || null,
      queueId: ticket.queueId || null,
      ticketId: ticket.id,
      type: "autoClose"
    });
  };
  
  const io = getIO();
  try {

    const { rows: tickets } = await Ticket.findAndCountAll({
      where: { status: {[Op.in] : ["open", "nps"]} , companyId},
      order: [["updatedAt", "DESC"]]
    });

    tickets.forEach(async ticket => {
      const showTicket = await ShowTicketService(ticket.id, companyId);
      const whatsapp = await Whatsapp.findByPk(showTicket?.whatsappId);
      const ticketTraking = await TicketTraking.findOne({
        where: {
          ticketId: ticket.id,
          finishedAt: null,          
        }
      })

      if (!whatsapp) return;
      
      let {timeInactiveMessage, //tempo em minutos para aviso de inatividade
           expiresInactiveMessage, //mensage de encerramento por inatividade
           inactiveMessage, //mensagem de aviso de inatividade
           expiresTicket, //tempo em horas para fechar ticket automaticamente
           expiresTicketNPS, //tempo em minutos para encerrar ticket aguardando avaliaçao
           whenExpiresTicket, //quando deve encerrar ticket por inatividade: 0-sempre 1-Somente se atendenten falou por ultimo
           complationMessage
      } = whatsapp
      
      
      // @ts-ignore: Unreachable code error
      if (expiresTicketNPS && expiresTicketNPS !== "" &&
        // @ts-ignore: Unreachable code error
        expiresTicketNPS !== "0" && Number(expiresTicketNPS) > 0) {
          const dataLimite = new Date()
          dataLimite.setMinutes(dataLimite.getMinutes() - Number(expiresTicketNPS));
    
          if (ticket.status === "nps" ) {
  
            const dataUltimaInteracaoChamado = new Date(showTicket.updatedAt)
  
            if (dataUltimaInteracaoChamado < dataLimite) {
  
              closeTicket(showTicket,  showTicket.status,  "");

              const bodyComplationMessage = formatBody(`\u200e${complationMessage}`, showTicket);
              
              if (complationMessage !== "" && complationMessage !== undefined) {
                const sentMessage = await SendWhatsAppMessage({ body: bodyComplationMessage, ticket: showTicket });
  
                await verifyMessage(sentMessage, showTicket, showTicket.contact);
              }

              await ticketTraking.update({
                finishedAt: moment().toDate(),
                closedAt: moment().toDate(),
                whatsappId: ticket.whatsappId,
                userId: ticket.userId,
              })

              io.to("open").emit(`company-${companyId}-ticket`, {
                action: "delete",
                ticket: showTicket,
                ticketId: showTicket.id
              });
  
            }
          }
      }

      // @ts-ignore: Unreachable code error
      if (expiresTicket && expiresTicket !== "" &&
        // @ts-ignore: Unreachable code error
        expiresTicket !== "0" && Number(expiresTicket) > 0) {

        //mensagem de encerramento por inatividade
        const bodyExpiresMessageInactive = formatBody(`\u200e${expiresInactiveMessage}`, showTicket);
     
        const dataLimite = new Date()
        dataLimite.setHours(dataLimite.getHours() - Number(expiresTicket));
	
        // @ts-ignore: Unreachable code error
        if (timeInactiveMessage && timeInactiveMessage !== "" && timeInactiveMessage !== null && 
        // @ts-ignore: Unreachable code error
        timeInactiveMessage !== "0" && Number(timeInactiveMessage) > 0) {
          dataLimite.setMinutes(dataLimite.getMinutes() - Number(timeInactiveMessage));
        }

        if (showTicket.status === "open" && !showTicket.isGroup) {

          const dataUltimaInteracaoChamado = new Date(showTicket.updatedAt)

          if (dataUltimaInteracaoChamado < dataLimite && (whenExpiresTicket === "0" || (whenExpiresTicket === "1" && showTicket.fromMe))) {

            closeTicket(showTicket,  showTicket.status,  bodyExpiresMessageInactive);
            
            if (expiresInactiveMessage !== "" && expiresInactiveMessage !== undefined) {
              const sentMessage = await SendWhatsAppMessage({ body: bodyExpiresMessageInactive, ticket: showTicket });

              await verifyMessage(sentMessage, showTicket, showTicket.contact);
            }

            await ticketTraking.update({
              finishedAt: moment().toDate(),
              closedAt: moment().toDate(),
              whatsappId: ticket.whatsappId,
              userId: ticket.userId,
            })

            io.to("open").emit(`company-${companyId}-ticket`, {
              action: "delete",
              ticket: showTicket,
              ticketId: showTicket.id
            });

          }
        }
      }

      // @ts-ignore: Unreachable code error
      if (timeInactiveMessage && timeInactiveMessage !== "" &&
        // @ts-ignore: Unreachable code error
        timeInactiveMessage !== "0" && Number(timeInactiveMessage) > 0) {

        //mensagem de aviso que atendimento vai ser encerrado se não houver atividade
        const bodyMessageInactive = formatBody(`\u200e${inactiveMessage}`, showTicket);

        const dataLimite = new Date()
        dataLimite.setMinutes(dataLimite.getMinutes() - Number(timeInactiveMessage));
	
        if (showTicket.status === "open" && !showTicket.isGroup) {

          const dataUltimaInteracaoChamado = new Date(showTicket.updatedAt)

          if (dataUltimaInteracaoChamado < dataLimite && !showTicket.sendInactiveMessage && (whenExpiresTicket === "0" || (whenExpiresTicket === "1" && showTicket.fromMe))) {

            const sentMessage = await SendWhatsAppMessage({ body: bodyMessageInactive, ticket: showTicket });
 
            await verifyMessage(sentMessage, showTicket, showTicket.contact);

            await showTicket.update({
              sendInactiveMessage: true
            });

            io.to("open").emit(`company-${companyId}-ticket`, {
              action: "delete",
              ticket: showTicket,
              ticketId: showTicket.id
            });

          }
        }
      }
    });

  } catch (e: any) {
    console.log('e', e)
  }

}
