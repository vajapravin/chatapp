import React, { useState } from "react";
import {
  BarChart2,
  Calendar,
  MapPin,
  Plus,
  Trash2,
  User as UserIcon,
  X,
} from "lucide-react";
import { ContactData, EventData, LocationData, PollData } from "../storage/db";
import { ulid } from "ulidx";

interface RichMessageComposerProps {
  isOpen: boolean;
  onClose: () => void;
  onSendPoll: (poll: PollData) => void;
  onSendLocation: (location: LocationData) => void;
  onSendContact: (contact: ContactData) => void;
  onSendEvent: (event: EventData) => void;
}

type ModalType = "menu" | "poll" | "location" | "contact" | "event";

export const RichMessageComposer: React.FC<RichMessageComposerProps> = ({
  isOpen,
  onClose,
  onSendPoll,
  onSendLocation,
  onSendContact,
  onSendEvent,
}) => {
  const [modalType, setModalType] = useState<ModalType>("menu");

  // Poll state
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);

  // Location state
  const [locName, setLocName] = useState("");
  const [locAddress, setLocAddress] = useState("");
  const [locLat, setLocLat] = useState<number>(37.7749);
  const [locLng, setLocLng] = useState<number>(-122.4194);
  const [locLoading, setLocLoading] = useState(false);

  // Contact state
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // Event state
  const [eventTitle, setEventTitle] = useState("");
  const [eventDesc, setEventDesc] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [eventLocation, setEventLocation] = useState("");

  if (!isOpen) return null;

  const handleOpenGps = () => {
    if (navigator.geolocation) {
      setLocLoading(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocLat(pos.coords.latitude);
          setLocLng(pos.coords.longitude);
          setLocName("Current Location");
          setLocAddress(`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
          setLocLoading(false);
        },
        () => setLocLoading(false)
      );
    }
  };

  const submitPoll = () => {
    const validOptions = pollOptions.filter((o) => o.trim().length > 0);
    if (!pollQuestion.trim() || validOptions.length < 2) return;

    const poll: PollData = {
      id: ulid(),
      question: pollQuestion.trim(),
      options: validOptions.map((text) => ({
        id: ulid(),
        text: text.trim(),
        votes: [],
      })),
      allowMultiple,
    };
    onSendPoll(poll);
    onClose();
  };

  const submitLocation = () => {
    onSendLocation({
      latitude: locLat,
      longitude: locLng,
      name: locName || "Shared Location",
      address: locAddress || undefined,
    });
    onClose();
  };

  const submitContact = () => {
    if (!contactName.trim() || !contactPhone.trim()) return;
    onSendContact({
      name: contactName.trim(),
      phoneNumber: contactPhone.trim(),
    });
    onClose();
  };

  const submitEvent = () => {
    if (!eventTitle.trim() || !eventDate) return;
    const startTimestamp = new Date(`${eventDate}T${eventTime || "09:00"}`).getTime();
    onSendEvent({
      title: eventTitle.trim(),
      description: eventDesc.trim() || undefined,
      startTime: startTimestamp,
      location: eventLocation.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#111b21] border border-[#2a3942] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#202c33] flex items-center justify-between bg-[#202c33]/50">
          <h3 className="font-semibold text-base text-[#e9edef]">
            {modalType === "menu" && "Share Content"}
            {modalType === "poll" && "Create a Poll"}
            {modalType === "location" && "Share Location"}
            {modalType === "contact" && "Share Contact"}
            {modalType === "event" && "Schedule Event"}
          </h3>
          <button onClick={onClose} className="text-[#8696a0] hover:text-[#e9edef] transition p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Menu Picker */}
        {modalType === "menu" && (
          <div className="p-6 grid grid-cols-2 gap-3.5">
            <button
              onClick={() => setModalType("poll")}
              className="flex flex-col items-center justify-center p-4 rounded-xl bg-[#202c33]/60 hover:bg-[#202c33] border border-[#2a3942] transition group"
            >
              <div className="w-12 h-12 rounded-full bg-[#00a884]/10 text-[#00a884] flex items-center justify-center mb-2 group-hover:scale-110 transition">
                <BarChart2 className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium text-[#e9edef]">Poll</span>
              <span className="text-xs text-[#8696a0]">Ask group a question</span>
            </button>

            <button
              onClick={() => setModalType("location")}
              className="flex flex-col items-center justify-center p-4 rounded-xl bg-[#202c33]/60 hover:bg-[#202c33] border border-[#2a3942] transition group"
            >
              <div className="w-12 h-12 rounded-full bg-[#3b82f6]/10 text-[#3b82f6] flex items-center justify-center mb-2 group-hover:scale-110 transition">
                <MapPin className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium text-[#e9edef]">Location</span>
              <span className="text-xs text-[#8696a0]">Share map coordinates</span>
            </button>

            <button
              onClick={() => setModalType("contact")}
              className="flex flex-col items-center justify-center p-4 rounded-xl bg-[#202c33]/60 hover:bg-[#202c33] border border-[#2a3942] transition group"
            >
              <div className="w-12 h-12 rounded-full bg-[#8b5cf6]/10 text-[#8b5cf6] flex items-center justify-center mb-2 group-hover:scale-110 transition">
                <UserIcon className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium text-[#e9edef]">Contact</span>
              <span className="text-xs text-[#8696a0]">Share phone contact</span>
            </button>

            <button
              onClick={() => setModalType("event")}
              className="flex flex-col items-center justify-center p-4 rounded-xl bg-[#202c33]/60 hover:bg-[#202c33] border border-[#2a3942] transition group"
            >
              <div className="w-12 h-12 rounded-full bg-[#f59e0b]/10 text-[#f59e0b] flex items-center justify-center mb-2 group-hover:scale-110 transition">
                <Calendar className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium text-[#e9edef]">Event</span>
              <span className="text-xs text-[#8696a0]">Schedule meeting</span>
            </button>
          </div>
        )}

        {/* Poll Modal */}
        {modalType === "poll" && (
          <div className="p-5 flex flex-col gap-4 max-h-[75vh] overflow-y-auto">
            <div>
              <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">Question</label>
              <input
                type="text"
                placeholder="Ask a question..."
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                className="w-full bg-[#202c33] text-[#e9edef] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">Options</label>
              <div className="space-y-2">
                {pollOptions.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder={`Option ${idx + 1}`}
                      value={opt}
                      onChange={(e) => {
                        const next = [...pollOptions];
                        next[idx] = e.target.value;
                        setPollOptions(next);
                      }}
                      className="flex-1 bg-[#202c33] text-[#e9edef] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                    />
                    {pollOptions.length > 2 && (
                      <button
                        onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))}
                        className="text-[#8696a0] hover:text-[#ef4444] p-1.5"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {pollOptions.length < 10 && (
                <button
                  onClick={() => setPollOptions([...pollOptions, ""])}
                  className="mt-2 text-xs text-[#00a884] font-medium flex items-center gap-1 hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" /> Add option
                </button>
              )}
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={allowMultiple}
                onChange={(e) => setAllowMultiple(e.target.checked)}
                className="w-4 h-4 accent-[#00a884] rounded"
              />
              <span className="text-xs text-[#e9edef]">Allow multiple answers</span>
            </label>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#202c33]">
              <button
                onClick={() => setModalType("menu")}
                className="px-4 py-2 text-xs text-[#8696a0] hover:text-white"
              >
                Back
              </button>
              <button
                disabled={!pollQuestion.trim() || pollOptions.filter((o) => o.trim()).length < 2}
                onClick={submitPoll}
                className="bg-[#00a884] text-[#111b21] font-semibold px-5 py-2 rounded-xl text-xs hover:bg-[#00a884]/90 transition disabled:opacity-50"
              >
                Create Poll
              </button>
            </div>
          </div>
        )}

        {/* Location Modal */}
        {modalType === "location" && (
          <div className="p-5 flex flex-col gap-4">
            <button
              onClick={handleOpenGps}
              disabled={locLoading}
              className="w-full flex items-center justify-center gap-2 bg-[#202c33] text-[#00a884] p-3 rounded-xl hover:bg-[#202c33]/80 transition text-sm font-medium border border-[#00a884]/30"
            >
              <MapPin className="w-4 h-4" />
              {locLoading ? "Locating..." : "Use Current GPS Location"}
            </button>

            <div>
              <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">Location Name</label>
              <input
                type="text"
                placeholder="e.g. Blue Bottle Coffee"
                value={locName}
                onChange={(e) => setLocName(e.target.value)}
                className="w-full bg-[#202c33] text-[#e9edef] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">Address / Details</label>
              <input
                type="text"
                placeholder="e.g. 66 Mint St, San Francisco"
                value={locAddress}
                onChange={(e) => setLocAddress(e.target.value)}
                className="w-full bg-[#202c33] text-[#e9edef] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#202c33]">
              <button onClick={() => setModalType("menu")} className="px-4 py-2 text-xs text-[#8696a0] hover:text-white">
                Back
              </button>
              <button
                onClick={submitLocation}
                className="bg-[#00a884] text-[#111b21] font-semibold px-5 py-2 rounded-xl text-xs hover:bg-[#00a884]/90 transition"
              >
                Send Location
              </button>
            </div>
          </div>
        )}

        {/* Contact Modal */}
        {modalType === "contact" && (
          <div className="p-5 flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">Contact Name</label>
              <input
                type="text"
                placeholder="Full Name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full bg-[#202c33] text-[#e9edef] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">Phone Number</label>
              <input
                type="text"
                placeholder="+1 555 123 4567"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full bg-[#202c33] text-[#e9edef] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-[#202c33]">
              <button onClick={() => setModalType("menu")} className="px-4 py-2 text-xs text-[#8696a0] hover:text-white">
                Back
              </button>
              <button
                disabled={!contactName.trim() || !contactPhone.trim()}
                onClick={submitContact}
                className="bg-[#00a884] text-[#111b21] font-semibold px-5 py-2 rounded-xl text-xs hover:bg-[#00a884]/90 transition disabled:opacity-50"
              >
                Share Contact
              </button>
            </div>
          </div>
        )}

        {/* Event Modal */}
        {modalType === "event" && (
          <div className="p-5 flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">Event Title</label>
              <input
                type="text"
                placeholder="Meeting or Celebration"
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                className="w-full bg-[#202c33] text-[#e9edef] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">Date</label>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full bg-[#202c33] text-[#e9edef] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">Time</label>
                <input
                  type="time"
                  value={eventTime}
                  onChange={(e) => setEventTime(e.target.value)}
                  className="w-full bg-[#202c33] text-[#e9edef] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">Location / Link</label>
              <input
                type="text"
                placeholder="Meeting room or URL"
                value={eventLocation}
                onChange={(e) => setEventLocation(e.target.value)}
                className="w-full bg-[#202c33] text-[#e9edef] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">Description</label>
              <textarea
                placeholder="Agenda or details..."
                value={eventDesc}
                onChange={(e) => setEventDesc(e.target.value)}
                rows={2}
                className="w-full bg-[#202c33] text-[#e9edef] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884] resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-[#202c33]">
              <button onClick={() => setModalType("menu")} className="px-4 py-2 text-xs text-[#8696a0] hover:text-white">
                Back
              </button>
              <button
                disabled={!eventTitle.trim() || !eventDate}
                onClick={submitEvent}
                className="bg-[#00a884] text-[#111b21] font-semibold px-5 py-2 rounded-xl text-xs hover:bg-[#00a884]/90 transition disabled:opacity-50"
              >
                Schedule Event
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
