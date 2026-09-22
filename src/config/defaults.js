/**
 * Default question texts and Part C reference transcript.
 *
 * In production these come from the live lesson record (question text) and
 * from referenceMaterialStore (clip transcript, seeded when the teacher
 * uploads the clip). We have neither DB nor S3 access right now, so the UI
 * pre-fills these from the Simulation 2024 / COBE FP fixture and lets the
 * operator edit them before running. Everything here is a starting value
 * only — whatever the UI submits is what actually gets scored.
 */

const DEFAULT_QUESTION_TEXTS = {
  "1a": "This is Q1 where you can select an answer by free speech - hometown. Today, I'm going to ask you about your hometown. Tell me where you live and a little bit about the place. What is your favorite place in your hometown? Why? Would you recommend your hometown to others? Explain why.",
  "1b": "Intro to Q2 to choose to answer in free speech? volunteering. Today, I'm going to ask you about volunteering. Tell me about your volunteering experience in high school. Explain what you did there. Do you think you will continue volunteering in the future?",
  "2": "Question about your project Simulation 3, 2019, COBE FP new. To begin with, tell me what your topic was and what you were hoping to learn from it. In addition, what two interesting facts did you learn from your project? Why do you think so? Also, what else would you like to know about the topic? Explain.",
  "2a": "Tell me briefly about your project. What you were hoping to learn from it.",
  "2b": "What new information did you learn from doing your project?",
  "3": "First question in Part C Simulation 2024, COBE FP Books. After watching the clip, what have you learned about the history of books? How did people record history in ancient times before the invention of books?",
  "4": "Second question in Part C Simulation 2024, COBE FP Books. What is the purpose of books? What was most interesting for you in the clip? Explain.",
};

const DEFAULT_PART_C_TRANSCRIPT = `I will lend books to people, but of course the rule is, don't do that unless you never intend to see that book again.
The physical object of a book is almost like a person. I mean, it has a spine, it has a backbone, it has a face. Actually, it can sort of be your friend.
Books record the basic human experience like no other medium can. Before there were books, ancient civilizations would record things by notches on bones, or rocks, or what have you.
The first books as we know them originated in ancient Rome. We go by a term called the codex, where they would have two heavy pieces of wood which would become the cover, and then the pages in between would then be stitched along one side to make something that was relatively easily transportable.
They all had to completely be done by hand, which became the work of what we know as a scribe. And frankly, they were luxury items.
And then a printer named Johannes Gutenberg, in the mid-15th century, created the means to mass-produce a book: the modern printing press. It wasn't until then that there was any kind of consumption of books by a large audience.
Book covers started to come into use in the early 19th century, and they were called dust wrappers. Usually had advertising on them, so people would take them off and throw them away. It wasn't until the turn of the 19th into the 20th century that book jackets could be seen as interesting design in and of themselves, such that I look at that, and I think, "I want to read that. That interests me."
The physical book itself represents both a technological advance, but also a piece of technology in and of itself. It delivered a user interface that was unlike anything that people had before. And you could argue that it's still the best way to deliver that to an audience.
I believe that the core purpose of a physical book is to record our existence, and to leave it behind on a shelf, in a library, in a home, for generations down the road to understand where they came from, that people went through some of the same things that they're going through. And it's like a dialogue that you have with the author.
I think you have a much more human relationship to a printed book than you do to one that's on a screen.
People want the experience of holding it, of turning the page, of marking their progress in a story. And then you have, of all things, the smell of a book: fresh ink on paper, or the aging paper smell. You don't really get that from anything else.
The book itself, you know, can't be turned off with a switch. It's a story that you can hold in your hand and carry around with you, and that's part of what makes them so valuable, and I think will make them valuable for the duration. A shelf of books, frankly, is made to outlast you, no matter who you are.`;

module.exports = { DEFAULT_QUESTION_TEXTS, DEFAULT_PART_C_TRANSCRIPT };
